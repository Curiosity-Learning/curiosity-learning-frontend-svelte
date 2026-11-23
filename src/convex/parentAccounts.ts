import { ConvexError, v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { internal } from './_generated/api';
import { internalAction, internalQuery, query } from './_generated/server';
import { mutation, parentScopedMutation } from './functions';
import { getAuthUserEmail } from './authEmail';
import { CHILD_EMAIL_DOMAIN } from './childAccounts';
import {
	CHILD_EMAIL_VERIFICATION_RATE_LIMIT,
	childEmailVerificationRateLimitKey,
	invalidateChildEmailVerifications,
	issueChildEmailVerification,
	scheduleRoutingChangedNotice
} from './childEmailVerification';
import { sendEmail } from './email/resend';
import { magicLinkEmail } from './email/templates';
import { mintMagicLink } from './magicLinks';
import { getParentNotificationSettings } from './notificationRouting';
import type { NotificationEmailResult } from './notifications';
import {
	getProfileByAuthUserId,
	getViewerIdentity,
	requireIdentity,
	requireProfile,
	requireRealIdentity
} from './permissions';
import { isRateLimited, recordRateLimitAttempt } from './rateLimiting';
import { ROUTING_CHANGE_MAX_SESSION_AGE_MS, requireFreshSession } from './sessionFreshness';
import {
	NOTIFICATION_EMAIL_IS_PARENT,
	OWN_EMAIL_REQUIRED,
	RESEND_LIMIT_REACHED,
	UNLINK_REQUIRES_CONFIRMED_EMAIL
} from '../lib/domain/child-notification-email';
import { APPROVING_ACCOUNT_MAGIC_LINK_SECONDS } from '../lib/auth/magic-link';

type Ctx = QueryCtx | MutationCtx;

const normalizeEmail = (value: string) => value.trim().toLowerCase();

// ---------------------------------------------------------------------------------------------
// PRD 2.4/6.1.10 (CL-703): "Parent Accounts & View as Child".
//
// "View as Child" (CL-801) lets a parent switch their session into the child's own interface,
// from a bar above the app: every query answers as the child and every write is refused while
// the view is on. The mechanics live in permissions.ts (`getViewerIdentity`), functions.ts (the
// write refusal) and viewAs.ts (start/stop). This module owns the link itself, the `parentLinks`
// row that decides which children a parent may view, and the parent's settings for each child.
//
// Linking: a `parentLinks` row is the source of truth for "can this parent read this child's
// data". Links are created at consent-approval time: `childSignup.approveConsent` finds or
// creates the Better Auth user + profile for `parentEmail` and inserts the link (via
// `ensureParentLink`) in the same mutation, so a parent can open /child/[id] (which switches into
// viewing as the child) straight from an email. That account is the one the parent later signs in to: an email+password sign-in uses it
// directly (after "Forgot password?" sets a password), and Better Auth's default account linking
// attaches a Google sign-in with the same verified email to the existing user rather than
// creating a new one (we never disable account linking in auth.ts).
//
// `syncParentLinks` remains as a lazy *claim* fallback, run by the app layout and /child/[id]: it
// looks up every APPROVED consent row (skipping any a 16+ child has unlinked, see
// `unlinkParent` / `unlinkedAt`) whose `parentEmail` matches the caller's own Better Auth
// email (via `getAuthUserEmail`, the same adapter helper `notificationsModel`/`notifications.ts`
// use) and materializes any missing `parentLinks` row. It covers consents approved before links
// were created at approval time, and re-signup/account-recovery edge cases where the caller's
// current auth user is not the one created at approval. Both paths are pure derivations from
// `parentChildConsents`, which remains the legal record of consent.
// ---------------------------------------------------------------------------------------------

// DOB precision note: `profiles.dateOfBirth` only ever stores "YYYY-MM" (month/year; the signup
// flow never collects a day, see auth/sign-up's formatDateOfBirth). Turning-16 logic here treats
// the child as 16 "from the first day of the birth month" — i.e. the MOST PERMISSIVE reading of
// the stored precision, deliberately the opposite rounding direction from the signup age-gate's
// `calculateAge` (which uses end-of-month, the most CONSERVATIVE reading, to keep someone
// classified as a minor for as long as the ambiguous data allows). Here the ambiguity should
// resolve in favor of the child gaining the unlink option as early as plausible, per PRD "child
// gains the option to unlink" at 16 — the two helpers intentionally round in opposite directions
// for their respective purposes.
export const isAtLeast16FromDateOfBirth = (
	dateOfBirth: string | undefined,
	now: number
): boolean => {
	if (!dateOfBirth) return false;
	const match = /^(\d{4})-(\d{2})$/.exec(dateOfBirth);
	if (!match) return false;
	const year = Number(match[1]);
	const month = Number(match[2]);
	if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return false;
	// First day of the birth month, UTC.
	const birthMonthStart = Date.UTC(year, month - 1, 1);
	const sixteenthBirthday = new Date(birthMonthStart);
	sixteenthBirthday.setUTCFullYear(sixteenthBirthday.getUTCFullYear() + 16);
	return now >= sixteenthBirthday.getTime();
};

const requireParentLink = async (
	ctx: Ctx,
	parentProfileId: Id<'profiles'>,
	childProfileId: Id<'profiles'>
): Promise<Doc<'parentLinks'>> => {
	const link = await ctx.db
		.query('parentLinks')
		.withIndex('by_parent_and_child', (q) =>
			q.eq('parentProfileId', parentProfileId).eq('childProfileId', childProfileId)
		)
		.unique();
	if (!link) {
		throw new ConvexError('You do not have access to this child account');
	}
	return link;
};

// ---------------------------------------------------------------------------------------------
// Linking
// ---------------------------------------------------------------------------------------------

/**
 * Inserts the `parentLinks` row for (parent, child) unless one already exists. Returns true when
 * a row was created. Shared by consent approval (`childSignup.approveConsent`) and the lazy claim
 * below, so both write the same shape.
 */
export const ensureParentLink = async (
	ctx: MutationCtx,
	parentProfileId: Id<'profiles'>,
	childProfileId: Id<'profiles'>
): Promise<boolean> => {
	const existing = await ctx.db
		.query('parentLinks')
		.withIndex('by_parent_and_child', (q) =>
			q.eq('parentProfileId', parentProfileId).eq('childProfileId', childProfileId)
		)
		.unique();
	if (existing) return false;
	await ctx.db.insert('parentLinks', { parentProfileId, childProfileId, createdAt: Date.now() });
	return true;
};

/**
 * Lazily materializes `parentLinks` rows for the CURRENT authenticated user, one per APPROVED
 * `parentChildConsents` row whose `parentEmail` matches the caller's own Better Auth email
 * (case-insensitive). Idempotent — safe to call on every Settings and /child/[id] page load
 * (each fires this once per mount). Links are normally created at consent approval; this is the
 * fallback for older consents (see the module header).
 */
export const syncParentLinks = parentScopedMutation({
	args: {},
	returns: v.object({ linkedCount: v.number() }),
	handler: async (ctx): Promise<{ linkedCount: number }> => {
		// CL-801: parent-scoped. Always the parent's own account, even while this session is
		// viewing as a child; it only ever links consents approved under the caller's own email.
		const identity = await requireRealIdentity(ctx);
		const profile = await requireProfile(ctx, identity.subject);

		const authEmail = await getAuthUserEmail(ctx, identity.subject);
		if (!authEmail) {
			return { linkedCount: 0 };
		}
		const normalizedEmail = normalizeEmail(authEmail);

		// `status` isn't part of `by_parent_email`, so the equality check runs as an in-memory
		// array filter (allowed) over the already-indexed rows rather than a query-level
		// `.filter()` (a convex_rules.txt violation — it would force a non-indexed scan).
		const approvedConsents = (
			await ctx.db
				.query('parentChildConsents')
				.withIndex('by_parent_email', (q) => q.eq('parentEmail', normalizedEmail))
				.collect()
		).filter((consent) => consent.status === 'approved' && consent.unlinkedAt === undefined);

		let linkedCount = 0;
		for (const consent of approvedConsents) {
			if (await ensureParentLink(ctx, profile._id, consent.childProfileId)) {
				linkedCount += 1;
			}
		}

		return { linkedCount };
	}
});

/**
 * Linked children for the current (parent) user, with the parent's settings for each: the
 * child's notification email (pending until the child confirms it) and the parent's own email
 * copies. Powers the Settings "Your children" card (CL-801; this used to live on the child's
 * overview page). Like every query it answers as the child while the session is viewing as one,
 * which has no children: Settings shows a "switch back" notice then.
 */
export const getMyLinkedChildren = query({
	args: {},
	returns: v.array(
		v.object({
			childProfileId: v.id('profiles'),
			firstName: v.union(v.string(), v.null()),
			lastName: v.union(v.string(), v.null()),
			username: v.union(v.string(), v.null()),
			notificationEmail: v.union(v.string(), v.null()),
			notificationEmailSetAt: v.union(v.number(), v.null()),
			notificationEmailVerified: v.boolean(),
			parentNotificationSettings: v.object({
				chatCopies: v.boolean(),
				activityCopies: v.boolean()
			})
		})
	),
	handler: async (ctx) => {
		const identity = await requireIdentity(ctx);
		const profile = await requireProfile(ctx, identity.subject);

		const links = await ctx.db
			.query('parentLinks')
			.withIndex('by_parent', (q) => q.eq('parentProfileId', profile._id))
			.collect();

		const children = [];
		for (const link of links) {
			const child = await ctx.db.get(link.childProfileId);
			if (!child) continue;
			children.push({
				childProfileId: child._id,
				firstName: child.firstName ?? null,
				lastName: child.lastName ?? null,
				username: child.username ?? null,
				notificationEmail: child.notificationEmail ?? null,
				notificationEmailSetAt: child.notificationEmailSetAt ?? null,
				notificationEmailVerified:
					Boolean(child.notificationEmail) && child.notificationEmailVerifiedAt !== undefined,
				// The CALLER's own per-child email choices (setParentNotificationSettings).
				parentNotificationSettings: await getParentNotificationSettings(ctx, profile._id, child._id)
			});
		}
		return children;
	}
});

/**
 * Edge case 14: whether a club-less account is a parent. A parent's account exists because they
 * approved a child, not to start a club, so the (app) layout, `/` and `/club` send an account
 * with no clubs but with a `parentLinks` row to Settings, where the "View as" bar and their
 * children's email settings are (lib/auth/no-club-allowlist.ts `clubLessLandingPath`; CL-801:
 * not into the view itself, or "Back to my account" would land straight back in it). Null for
 * signed-out callers and accounts without links, so the gates can call it unconditionally.
 * Answers as the child while viewing (a child has no links), so a club-less child's view lands
 * where the child would.
 */
export const getMyFirstLinkedChildId = query({
	args: {},
	returns: v.union(v.id('profiles'), v.null()),
	handler: async (ctx) => {
		const identity = await getViewerIdentity(ctx);
		if (!identity) return null;
		const profile = await getProfileByAuthUserId(ctx, identity.subject);
		if (!profile) return null;
		const link = await ctx.db
			.query('parentLinks')
			.withIndex('by_parent', (q) => q.eq('parentProfileId', profile._id))
			.first();
		return link?.childProfileId ?? null;
	}
});

/**
 * Child-side: whether the CURRENT user (assumed to be a child account) has a linked parent and
 * is old enough (>=16) to unlink. Powers the Settings "Linked parent" card for child accounts.
 */
export const getMyParentLink = query({
	args: {},
	returns: v.union(
		v.object({
			parentProfileId: v.id('profiles'),
			parentFirstName: v.union(v.string(), v.null()),
			parentLastName: v.union(v.string(), v.null()),
			canUnlink: v.boolean()
		}),
		v.null()
	),
	handler: async (ctx) => {
		const identity = await requireIdentity(ctx);
		const profile = await requireProfile(ctx, identity.subject);

		const link = await ctx.db
			.query('parentLinks')
			.withIndex('by_child', (q) => q.eq('childProfileId', profile._id))
			.first();
		if (!link) return null;

		const parent = await ctx.db.get(link.parentProfileId);
		const canUnlink = isAtLeast16FromDateOfBirth(profile.dateOfBirth, Date.now());
		return {
			parentProfileId: link.parentProfileId,
			parentFirstName: parent?.firstName ?? null,
			parentLastName: parent?.lastName ?? null,
			canUnlink
		};
	}
});

/**
 * Child-side: severs a `parentLinks` row. Only the child themselves may call this (never the
 * parent), and only once they are >=16 by stored DOB (PRD: "restrictions auto-lift at 16, child
 * GAINS the option to unlink; access doesn't auto-sever until they unlink" — so under-16 child
 * accounts cannot call this at all, and turning 16 does not auto-sever anything by itself).
 * Also stamps `unlinkedAt` on the consent behind the link so `syncParentLinks` never re-creates it.
 *
 * CL-769 (review S7/D4, edge case 13):
 * - Refused unless the child has a CONFIRMED notification email of their own
 *   (UNLINK_REQUIRES_CONFIRMED_EMAIL): once unlinked, the parent receives nothing about the child
 *   — critical notices included (notificationRouting.ts rule 4) — so without one, important
 *   notices would reach nobody. The child adds one with setMyNotificationEmail.
 * - The parent's own per-child email settings (parentNotificationSettings) for this pair are
 *   DELETED, not just ignored: they describe a relationship that no longer exists, and a stale
 *   row must not come back to life if the pair were ever linked again by a new consent.
 * - The parent gets ONE final plain notice ("{child} has unlinked your parent account..."), sent
 *   to the consent address(es) this call unlinked; a repeated call unlinks nothing and sends
 *   nothing.
 */
export const unlinkParent = mutation({
	args: {
		parentProfileId: v.id('profiles')
	},
	returns: v.object({ success: v.boolean() }),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const profile = await requireProfile(ctx, identity.subject);

		if (!isAtLeast16FromDateOfBirth(profile.dateOfBirth, Date.now())) {
			throw new ConvexError('You must be at least 16 to unlink a parent account');
		}
		if (!profile.notificationEmail || profile.notificationEmailVerifiedAt === undefined) {
			throw new ConvexError(
				`${UNLINK_REQUIRES_CONFIRMED_EMAIL}: Add and confirm your own email address first, so important notices can still reach you.`
			);
		}

		const link = await ctx.db
			.query('parentLinks')
			.withIndex('by_parent_and_child', (q) =>
				q.eq('parentProfileId', args.parentProfileId).eq('childProfileId', profile._id)
			)
			.unique();
		if (link) {
			await ctx.db.delete(link._id);
		}
		const settings = await ctx.db
			.query('parentNotificationSettings')
			.withIndex('by_parent_and_child', (q) =>
				q.eq('parentProfileId', args.parentProfileId).eq('childProfileId', profile._id)
			)
			.unique();
		if (settings) {
			await ctx.db.delete(settings._id);
		}

		// Mark the consent(s) behind this link as unlinked, or the parent's next syncParentLinks
		// (Settings, /child/[id]) would claim the link straight back. Older consents may predate
		// `parentProfileId`, so a row without one is matched on the parent's auth email instead.
		// Runs even when no link row was found, so a link that was never claimed yet can't be
		// claimed later either.
		const parentProfile = await ctx.db.get(args.parentProfileId);
		const parentAuthEmail = parentProfile
			? await getAuthUserEmail(ctx, parentProfile.authUserId)
			: null;
		const normalizedParentEmail = parentAuthEmail ? normalizeEmail(parentAuthEmail) : null;
		const consents = await ctx.db
			.query('parentChildConsents')
			.withIndex('by_child_profile_id', (q) => q.eq('childProfileId', profile._id))
			.collect();
		const now = Date.now();
		const unlinkedConsentIds: Id<'parentChildConsents'>[] = [];
		for (const consent of consents) {
			if (consent.unlinkedAt !== undefined) continue;
			const isThisParent = consent.parentProfileId
				? consent.parentProfileId === args.parentProfileId
				: normalizedParentEmail !== null &&
					normalizeEmail(consent.parentEmail) === normalizedParentEmail;
			if (!isThisParent) continue;
			await ctx.db.patch(consent._id, { unlinkedAt: now, updatedAt: now });
			// Only approved consents ever made this person the child's parent.
			if (consent.status === 'approved') unlinkedConsentIds.push(consent._id);
		}
		if (unlinkedConsentIds.length > 0) {
			await ctx.scheduler.runAfter(0, internal.childEmailVerification.sendParentUnlinkedNotice, {
				childProfileId: profile._id,
				consentIds: unlinkedConsentIds
			});
		}
		return { success: true };
	}
});

// ---------------------------------------------------------------------------------------------
// The parent's settings for a child (Settings, "Your children" card)
// ---------------------------------------------------------------------------------------------
// CL-801 removed the read-only child overview (getChildOverview, listChildRooms,
// listChildMessages): a parent now sees the child's clubs, projects and chats in the app itself,
// from the "View as" bar (viewAs.ts). What stays here are the parent-owned settings for the child.
// The parent-side WRITES that name a child (setChildNotificationEmail,
// setParentNotificationSettings) write parent-owned settings, never act as the child, and call
// requireParentLink first. The structural test at the bottom of parentAccounts.spec.ts enforces
// that rule for every public mutation that takes a profile id (review S13). While a parent is
// viewing as a child they are refused like every other write (functions.ts).

// ---------------------------------------------------------------------------------------------
// Child notification email
// ---------------------------------------------------------------------------------------------

// Deliberately strict-but-simple: one "@", no whitespace, a dot in the domain. The address is
// only ever used as a Resend recipient, so a false negative costs a retry, a false positive an
// undeliverable email — neither is a security concern.
const isPlausibleEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

/**
 * The address rules for a child's notification email, shared by the child page
 * (setChildNotificationEmail) and the consent screen (childSignup.approveConsent) so the two can
 * never accept different addresses. Returns the normalized address or throws a ConvexError:
 * not plausible / the synthetic child domain, or one of `parentAddresses` (edge case 1: child
 * wording and child links would reach the parent — the UI maps NOTIFICATION_EMAIL_IS_PARENT to
 * its own copy). Addresses of other accounts are deliberately allowed (edge cases 2-3).
 */
export const normalizeChildNotificationEmail = (raw: string, parentAddresses: string[]) => {
	const email = normalizeEmail(raw);
	if (!isPlausibleEmail(email) || email.endsWith(`@${CHILD_EMAIL_DOMAIN}`)) {
		throw new ConvexError('Please enter a valid email address');
	}
	if (parentAddresses.some((address) => normalizeEmail(address) === email)) {
		throw new ConvexError(
			`${NOTIFICATION_EMAIL_IS_PARENT}: That's your own address. Leave it empty to get these emails yourself.`
		);
	}
	return email;
};

// The parent's own sign-in email and the approved consent addresses for this child (the two can
// differ, review S9).
const getParentOwnAddresses = async (
	ctx: MutationCtx,
	args: { parentAuthUserId: string; child: Doc<'profiles'> }
) => {
	const parentAuthEmail = await getAuthUserEmail(ctx, args.parentAuthUserId);
	const consents = await ctx.db
		.query('parentChildConsents')
		.withIndex('by_child_profile_id', (q) => q.eq('childProfileId', args.child._id))
		.collect();
	return [
		...(parentAuthEmail ? [parentAuthEmail] : []),
		...consents.filter((consent) => consent.status === 'approved').map((c) => c.parentEmail)
	];
};

/**
 * Sets, changes, re-sends or clears (`email: null`) the real address a child's NON-critical
 * notification emails go to — club/project chat activity and other high-tier kinds — instead of
 * the parent (see profiles.notificationEmail in schema.ts and notificationRouting.resolveEmailRecipients).
 *
 * One of the two parentAccounts mutations that name a childProfileId (with
 * setParentNotificationSettings), and NOT an "act as the child" path (see the module header and
 * the structural test in parentAccounts.spec.ts):
 * it writes a parent-owned setting onto the child's profile and runs nothing under the child's
 * identity. Only the linked parent may call it, because a child cannot consent to receiving
 * email on their own — the parent does so on their behalf, and who/when is recorded. "Resend"
 * is this same call with the current pending address, so no second childProfileId mutation
 * exists.
 *
 * CL-768 (review B2/B3/S5):
 * - A new address is PENDING until the child confirms it while signed in as themselves
 *   (childEmailVerification.ts); until then everything routes as if no address were set.
 *   Changing the address resets the verification and issues a new link; removing it clears the
 *   address, its verification and source, and invalidates outstanding links.
 * - Only from a session created in the last 15 minutes (sessionFreshness.ts): on a shared
 *   computer, a parent session left signed in must not let someone else redirect the child's
 *   emails. The UI asks the parent to sign in again.
 * - Every routing change emails the parent (the approved consent address) a plain notice.
 * - The parent's own addresses are refused (edge case 1): child-worded email with child links
 *   would reach the parent. Addresses that belong to other accounts are NOT refused (edge cases
 *   2-3): siblings may share one inbox, "send it to dad" is legitimate, and refusing would reveal
 *   which addresses have accounts. Verification is per child profile.
 * - At most 3 confirmation emails per child per 24 h (set, change and resend all count).
 */
export const setChildNotificationEmail = mutation({
	args: {
		childProfileId: v.id('profiles'),
		email: v.union(v.string(), v.null())
	},
	returns: v.object({
		notificationEmail: v.union(v.string(), v.null()),
		status: v.union(v.literal('none'), v.literal('pending'), v.literal('verified')),
		// True when a confirmation email was (re)sent by this call.
		verificationSent: v.boolean()
	}),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const parentProfile = await requireProfile(ctx, identity.subject);
		await requireParentLink(ctx, parentProfile._id, args.childProfileId);

		const child = await ctx.db.get(args.childProfileId);
		if (!child) {
			throw new ConvexError('Child profile not found');
		}
		const childAuthEmail = await getAuthUserEmail(ctx, child.authUserId);
		if (!childAuthEmail?.toLowerCase().endsWith(`@${CHILD_EMAIL_DOMAIN}`)) {
			// An adult account already has a real, verified email of its own.
			throw new ConvexError('Notification email can only be set for a child account');
		}

		const email =
			args.email === null
				? null
				: normalizeChildNotificationEmail(
						args.email,
						await getParentOwnAddresses(ctx, { parentAuthUserId: identity.subject, child })
					);

		const current = child.notificationEmail ?? null;
		const currentlyVerified = current !== null && child.notificationEmailVerifiedAt !== undefined;
		// Nothing to do (no fresh sign-in needed for a no-op).
		if (email === current && (email === null || currentlyVerified)) {
			return {
				notificationEmail: email,
				status: email === null ? ('none' as const) : ('verified' as const),
				verificationSent: false
			};
		}

		await requireFreshSession(ctx, ROUTING_CHANGE_MAX_SESSION_AGE_MS);
		const now = Date.now();

		if (email === null) {
			await ctx.db.patch(child._id, {
				notificationEmail: undefined,
				notificationEmailSetAt: undefined,
				notificationEmailSetByProfileId: undefined,
				notificationEmailVerifiedAt: undefined,
				notificationEmailSource: undefined,
				notificationEmailReminderSentAt: undefined,
				updatedAt: now
			});
			await invalidateChildEmailVerifications(ctx, child._id);
			await scheduleRoutingChangedNotice(ctx, { childProfileId: child._id, change: 'removed' });
			return { notificationEmail: null, status: 'none' as const, verificationSent: false };
		}

		// A new address, or the same pending one again ("Resend"). Checked before any write: the
		// throw rolls nothing back that matters, and the attempt is only recorded when it is sent.
		const rateLimitKey = childEmailVerificationRateLimitKey(child._id);
		if (await isRateLimited(ctx, rateLimitKey, CHILD_EMAIL_VERIFICATION_RATE_LIMIT)) {
			throw new ConvexError(
				`${RESEND_LIMIT_REACHED}: Too many confirmation emails for this account today. Please try again tomorrow.`
			);
		}
		await recordRateLimitAttempt(ctx, rateLimitKey, CHILD_EMAIL_VERIFICATION_RATE_LIMIT);

		const isResend = email === current;
		if (!isResend) {
			await ctx.db.patch(child._id, {
				notificationEmail: email,
				notificationEmailSetAt: now,
				notificationEmailSetByProfileId: parentProfile._id,
				notificationEmailVerifiedAt: undefined,
				notificationEmailSource: 'childPage',
				notificationEmailReminderSentAt: undefined,
				updatedAt: now
			});
		}
		await issueChildEmailVerification(ctx, {
			childProfileId: child._id,
			email,
			requestedByProfileId: parentProfile._id
		});
		// A resend changes no routing, so the parent is only told about new addresses.
		if (!isResend) {
			await scheduleRoutingChangedNotice(ctx, {
				childProfileId: child._id,
				change: 'pending',
				email
			});
		}
		return { notificationEmail: email, status: 'pending' as const, verificationSent: true };
	}
});

/**
 * The linked parent's own choices about the emails they get for this child (CL-768/CL-769,
 * review S6/D3/D7; parentNotificationSettings in schema.ts): `chatCopies` (club/project chat
 * emails) and `activityCopies` (the other high-tier kinds). Both default to off: once the child
 * has confirmed their own address those emails go to the child only, and the parent can opt back
 * in. They change nothing before the child has a confirmed address (chat emails come to the
 * parent anyway, other kinds go nowhere) and nothing about critical notices, which always come to
 * the parent. Omitted fields keep their current value.
 *
 * Like setChildNotificationEmail this names a childProfileId, writes a parent-owned row and runs
 * nothing as the child: linked parent only (requireParentLink), and only from a session created
 * in the last 15 minutes (review S5: on a shared computer, a child using the parent's leftover
 * session must not be able to switch the parent's copies off — or on). A no-op needs no fresh
 * sign-in.
 */
export const setParentNotificationSettings = mutation({
	args: {
		childProfileId: v.id('profiles'),
		chatCopies: v.optional(v.boolean()),
		activityCopies: v.optional(v.boolean())
	},
	returns: v.object({ chatCopies: v.boolean(), activityCopies: v.boolean() }),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const parentProfile = await requireProfile(ctx, identity.subject);
		await requireParentLink(ctx, parentProfile._id, args.childProfileId);

		const child = await ctx.db.get(args.childProfileId);
		if (!child) {
			throw new ConvexError('Child profile not found');
		}
		const existing = await ctx.db
			.query('parentNotificationSettings')
			.withIndex('by_parent_and_child', (q) =>
				q.eq('parentProfileId', parentProfile._id).eq('childProfileId', child._id)
			)
			.unique();
		const current = {
			chatCopies: existing?.chatCopies ?? false,
			activityCopies: existing?.activityCopies ?? false
		};
		const next = {
			chatCopies: args.chatCopies ?? current.chatCopies,
			activityCopies: args.activityCopies ?? current.activityCopies
		};
		if (next.chatCopies === current.chatCopies && next.activityCopies === current.activityCopies) {
			return next;
		}

		await requireFreshSession(ctx, ROUTING_CHANGE_MAX_SESSION_AGE_MS);
		const now = Date.now();
		if (existing) {
			await ctx.db.patch(existing._id, { ...next, updatedAt: now });
		} else {
			await ctx.db.insert('parentNotificationSettings', {
				parentProfileId: parentProfile._id,
				childProfileId: child._id,
				...next,
				updatedAt: now
			});
		}
		return next;
	}
});

// ---------------------------------------------------------------------------------------------
// The child's own notification email, 16+ (CL-769, review D4 / edge case 13)
// ---------------------------------------------------------------------------------------------

// The caller is a child account (synthetic auth email) aged 16+ by the permissive DOB reading
// above: the age at which they may unlink their parent, and so must be able to receive their own
// important notices. Under-16 children never get here (server-side, not just hidden in the UI).
const isChildAccountAtLeast16 = async (ctx: Ctx, profile: Doc<'profiles'>) => {
	if (!isAtLeast16FromDateOfBirth(profile.dateOfBirth, Date.now())) return false;
	const authEmail = await getAuthUserEmail(ctx, profile.authUserId);
	return Boolean(authEmail?.toLowerCase().endsWith(`@${CHILD_EMAIL_DOMAIN}`));
};

// Whether an approved consent the child has not unlinked exists: the child still has a parent
// who receives their critical notices.
const hasLinkedParentConsent = async (ctx: Ctx, childProfileId: Id<'profiles'>) =>
	(
		await ctx.db
			.query('parentChildConsents')
			.withIndex('by_child_profile_id', (q) => q.eq('childProfileId', childProfileId))
			.collect()
	).some((consent) => consent.status === 'approved' && consent.unlinkedAt === undefined);

// Addresses a child may not use as their own: every approved consent address (unlinked or not)
// and the auth email of every linked parent (edge case 1: child-worded email and child links
// would reach the parent).
const getChildsParentAddresses = async (ctx: MutationCtx, childProfileId: Id<'profiles'>) => {
	const consents = await ctx.db
		.query('parentChildConsents')
		.withIndex('by_child_profile_id', (q) => q.eq('childProfileId', childProfileId))
		.collect();
	const links = await ctx.db
		.query('parentLinks')
		.withIndex('by_child', (q) => q.eq('childProfileId', childProfileId))
		.collect();
	const linkedParentEmails: string[] = [];
	for (const link of links) {
		const parent = await ctx.db.get(link.parentProfileId);
		const email = parent ? await getAuthUserEmail(ctx, parent.authUserId) : null;
		if (email) linkedParentEmails.push(email);
	}
	return [
		...consents.filter((consent) => consent.status === 'approved').map((c) => c.parentEmail),
		...linkedParentEmails
	];
};

const ownEmailStatusValidator = v.union(
	v.literal('none'),
	v.literal('pending'),
	v.literal('verified')
);

/**
 * Child-side, for the Settings "Your email" card: the caller's own notification email and its
 * state, or null when the caller is not a child account aged 16+ (the card is not shown).
 * `hasLinkedParent` says whether removing the address is allowed (see setMyNotificationEmail).
 */
export const getMyNotificationEmail = query({
	args: {},
	returns: v.union(
		v.object({
			notificationEmail: v.union(v.string(), v.null()),
			status: ownEmailStatusValidator,
			setAt: v.union(v.number(), v.null()),
			hasLinkedParent: v.boolean()
		}),
		v.null()
	),
	handler: async (ctx) => {
		const identity = await requireIdentity(ctx);
		const profile = await requireProfile(ctx, identity.subject);
		if (!(await isChildAccountAtLeast16(ctx, profile))) return null;
		const email = profile.notificationEmail ?? null;
		return {
			notificationEmail: email,
			status:
				email === null
					? ('none' as const)
					: profile.notificationEmailVerifiedAt !== undefined
						? ('verified' as const)
						: ('pending' as const),
			setAt: profile.notificationEmailSetAt ?? null,
			hasLinkedParent: await hasLinkedParentConsent(ctx, profile._id)
		};
	}
});

/**
 * Child-side twin of setChildNotificationEmail: a child aged 16+ sets, changes, re-sends or
 * removes (`email: null`) their OWN notification email. Keyed by the caller (no profile id
 * argument), so it is outside the parent-link rule of the structural scan.
 *
 * - Child accounts aged 16+ only, checked here (ConvexError otherwise).
 * - The same pending -> confirm flow as a parent-entered address (childEmailVerification.ts):
 *   the address receives only a confirmation email until the child confirms it at
 *   /verify-email/[token] while signed in; `requestedByProfileId` and
 *   `notificationEmailSetByProfileId` are the child, `notificationEmailSource` is 'self'.
 * - The same address rules (normalizeChildNotificationEmail): the parent's addresses are refused.
 * - Fresh session (< 15 min, sessionFreshness.ts), like every routing change: a session left
 *   signed in on a shared device must not let someone else redirect the child's notices.
 * - Shares the child's 3-a-day confirmation-email limit with the parent's form.
 * - A linked parent gets the usual plain routing-changed notice (getRoutingNoticeRecipient skips
 *   unlinked consents), and while linked can still change the address from the child's page.
 * - Removing is refused once no parent is linked (OWN_EMAIL_REQUIRED): the address is then the
 *   only way important notices reach the child. Changing it is allowed; until the new address
 *   is confirmed, emails reach nobody (in-app notifications still arrive) — the trade-off of
 *   keeping one address field rather than a separate "pending replacement".
 */
export const setMyNotificationEmail = mutation({
	args: { email: v.union(v.string(), v.null()) },
	returns: v.object({
		notificationEmail: v.union(v.string(), v.null()),
		status: ownEmailStatusValidator,
		verificationSent: v.boolean()
	}),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const profile = await requireProfile(ctx, identity.subject);
		if (!(await isChildAccountAtLeast16(ctx, profile))) {
			throw new ConvexError('Only accounts aged 16 or older can set their own email here');
		}

		const email =
			args.email === null
				? null
				: normalizeChildNotificationEmail(
						args.email,
						await getChildsParentAddresses(ctx, profile._id)
					);
		const current = profile.notificationEmail ?? null;
		const currentlyVerified = current !== null && profile.notificationEmailVerifiedAt !== undefined;
		if (email === current && (email === null || currentlyVerified)) {
			return {
				notificationEmail: email,
				status: email === null ? ('none' as const) : ('verified' as const),
				verificationSent: false
			};
		}
		if (email === null && !(await hasLinkedParentConsent(ctx, profile._id))) {
			throw new ConvexError(
				`${OWN_EMAIL_REQUIRED}: You need an email address so important notices can reach you. You can change it, but not remove it.`
			);
		}

		await requireFreshSession(ctx, ROUTING_CHANGE_MAX_SESSION_AGE_MS);
		const now = Date.now();

		if (email === null) {
			await ctx.db.patch(profile._id, {
				notificationEmail: undefined,
				notificationEmailSetAt: undefined,
				notificationEmailSetByProfileId: undefined,
				notificationEmailVerifiedAt: undefined,
				notificationEmailSource: undefined,
				notificationEmailReminderSentAt: undefined,
				updatedAt: now
			});
			await invalidateChildEmailVerifications(ctx, profile._id);
			await scheduleRoutingChangedNotice(ctx, { childProfileId: profile._id, change: 'removed' });
			return { notificationEmail: null, status: 'none' as const, verificationSent: false };
		}

		const rateLimitKey = childEmailVerificationRateLimitKey(profile._id);
		if (await isRateLimited(ctx, rateLimitKey, CHILD_EMAIL_VERIFICATION_RATE_LIMIT)) {
			throw new ConvexError(
				`${RESEND_LIMIT_REACHED}: Too many confirmation emails for this account today. Please try again tomorrow.`
			);
		}
		await recordRateLimitAttempt(ctx, rateLimitKey, CHILD_EMAIL_VERIFICATION_RATE_LIMIT);

		const isResend = email === current;
		if (!isResend) {
			await ctx.db.patch(profile._id, {
				notificationEmail: email,
				notificationEmailSetAt: now,
				notificationEmailSetByProfileId: profile._id,
				notificationEmailVerifiedAt: undefined,
				notificationEmailSource: 'self',
				notificationEmailReminderSentAt: undefined,
				updatedAt: now
			});
		}
		await issueChildEmailVerification(ctx, {
			childProfileId: profile._id,
			email,
			requestedByProfileId: profile._id
		});
		if (!isResend) {
			await scheduleRoutingChangedNotice(ctx, {
				childProfileId: profile._id,
				change: 'pending',
				email
			});
		}
		return { notificationEmail: email, status: 'pending' as const, verificationSent: true };
	}
});

// ---------------------------------------------------------------------------------------------
// Signed in with a different email (review S9)
// ---------------------------------------------------------------------------------------------

// The approving parent's account is the one created (or adopted) under the consent address at
// approval. A parent who later signs up or signs in with another address B has a second,
// unlinked account: /child/{id} says "not linked", Settings lists no children. The child page
// offers to email a sign-in link to "the address that approved", resolved here, server-side, so
// the page — signed in as B — never learns that address.
//
// At most 3 requests per (caller, child) per 24 h, counted for EVERY request (with or without a
// consent behind it), so the limit itself reveals nothing either.
export const APPROVING_ACCOUNT_LINK_RATE_LIMIT = { maxAttempts: 3, windowMs: 24 * 60 * 60 * 1000 };
export const approvingAccountLinkRateLimitKey = (
	callerProfileId: Id<'profiles'>,
	childProfileId: Id<'profiles'>
) => `approvingAccountSignInLink:${callerProfileId}:${childProfileId}`;
// And at most 3 links per consent (i.e. per approving address and child) per 24 h whoever asks
// (review S4): accounts are cheap, so the per-caller cap alone would let any group of adults flood
// a parent with sign-in links. Over this cap nothing is sent and the answer stays `requested`, so
// it reveals nothing about the consent.
export const approvingAccountLinkConsentRateLimitKey = (consentId: Id<'parentChildConsents'>) =>
	`approvingAccountSignInLink:consent:${consentId}`;

/**
 * Emails a one-time sign-in link (30 min, continuing to /child/{id}) to the approving address of
 * this child's consent, when that address is not the caller's own. Answers `requested` whether
 * or not such a consent exists, whether or not the caller is the approving parent, and whether
 * or not anything was sent; it never returns or reveals the address (not even masked). Only
 * `rateLimited` differs, and that depends on the caller's own requests alone.
 *
 * Takes a childProfileId without calling requireParentLink: the caller is by definition NOT
 * linked (that is the situation this recovers from). On the structural scan's allowlist for that
 * reason: it discloses nothing and only ever emails the address that proved itself by approving
 * consent — the link signs in as THAT account, never the caller's.
 */
export const requestApprovingAccountSignInLink = mutation({
	args: { childProfileId: v.id('profiles') },
	returns: v.object({ status: v.union(v.literal('requested'), v.literal('rateLimited')) }),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const profile = await requireProfile(ctx, identity.subject);

		const rateLimitKey = approvingAccountLinkRateLimitKey(profile._id, args.childProfileId);
		if (await isRateLimited(ctx, rateLimitKey, APPROVING_ACCOUNT_LINK_RATE_LIMIT)) {
			return { status: 'rateLimited' as const };
		}
		await recordRateLimitAttempt(ctx, rateLimitKey, APPROVING_ACCOUNT_LINK_RATE_LIMIT);

		const consent = (
			await ctx.db
				.query('parentChildConsents')
				.withIndex('by_child_profile_id', (q) => q.eq('childProfileId', args.childProfileId))
				.order('desc')
				.collect()
		).find((row) => row.status === 'approved' && row.unlinkedAt === undefined);
		const callerEmail = await getAuthUserEmail(ctx, identity.subject);
		const callerIsChild = Boolean(callerEmail?.toLowerCase().endsWith(`@${CHILD_EMAIL_DOMAIN}`));
		if (
			consent &&
			!callerIsChild &&
			(!callerEmail || normalizeEmail(callerEmail) !== normalizeEmail(consent.parentEmail)) &&
			!(await isRateLimited(
				ctx,
				approvingAccountLinkConsentRateLimitKey(consent._id),
				APPROVING_ACCOUNT_LINK_RATE_LIMIT
			))
		) {
			await recordRateLimitAttempt(
				ctx,
				approvingAccountLinkConsentRateLimitKey(consent._id),
				APPROVING_ACCOUNT_LINK_RATE_LIMIT
			);
			await ctx.scheduler.runAfter(0, internal.parentAccounts.sendApprovingAccountSignInLink, {
				consentId: consent._id
			});
		}
		return { status: 'requested' as const };
	}
});

export const getApprovingAccountLinkTarget = internalQuery({
	args: { consentId: v.id('parentChildConsents') },
	returns: v.union(v.object({ email: v.string(), childProfileId: v.id('profiles') }), v.null()),
	handler: async (ctx, args) => {
		const consent = await ctx.db.get(args.consentId);
		if (!consent || consent.status !== 'approved' || consent.unlinkedAt !== undefined) return null;
		return { email: normalizeEmail(consent.parentEmail), childProfileId: consent.childProfileId };
	}
});

// Minted here, in the action, right before sending (review S2: OS randomness, no token in
// scheduler args). mintMagicLink returns null for an address it may not sign in (no account,
// unverified, platform admin): then nothing is sent and nothing is logged.
export const sendApprovingAccountSignInLink = internalAction({
	args: { consentId: v.id('parentChildConsents') },
	returns: v.null(),
	handler: async (ctx, args) => {
		const target = await ctx.runQuery(internal.parentAccounts.getApprovingAccountLinkTarget, args);
		if (!target) return null;
		const url = await mintMagicLink(ctx, {
			email: target.email,
			callbackPath: `/child/${target.childProfileId}`,
			expiresInSeconds: APPROVING_ACCOUNT_MAGIC_LINK_SECONDS
		});
		if (!url) return null;
		const content = magicLinkEmail({ url, expiresIn: '30 minutes' });
		let result: NotificationEmailResult;
		try {
			const { providerMessageId } = await sendEmail({
				to: target.email,
				type: 'magic-link',
				...content
			});
			result = { status: 'sent', to: target.email, providerMessageId };
		} catch (error) {
			result = {
				status: 'failed',
				to: target.email,
				error: error instanceof Error ? error.message : String(error)
			};
		}
		await ctx.runMutation(internal.notifications.logEmailDelivery, {
			recipientProfileId: target.childProfileId,
			kind: 'approving_account_sign_in_link',
			subject: content.subject,
			result,
			audience: 'parent'
		});
		return null;
	}
});
