import { ConvexError, v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { mutation, query } from './_generated/server';
import { getAuthUserEmail } from './authEmail';
import { CHILD_EMAIL_DOMAIN } from './childAccounts';
import { requireIdentity, requireProfile, requireRealIdentity } from './permissions';

type Ctx = QueryCtx | MutationCtx;

const normalizeEmail = (value: string) => value.trim().toLowerCase();

// ---------------------------------------------------------------------------------------------
// PRD 2.4/6.1.10 (CL-703): "Parent Accounts & View as Child".
//
// "View as Child" (CL-734) lets a parent switch their session into the child's own interface:
// every query answers as the child and every write is refused while the view is active. The
// mechanics live in permissions.ts (`getViewerIdentity`) and viewAs.ts (start/stop). This module
// owns the link itself — the `parentLinks` row that decides which children a parent may view.
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
// `syncParentLinks` remains as a lazy *claim* fallback, run by the app layout and /child/[id] loads: it
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
export const syncParentLinks = mutation({
	args: {},
	returns: v.object({ linkedCount: v.number() }),
	handler: async (ctx): Promise<{ linkedCount: number }> => {
		// Always the parent's own account, even while that session is viewing as a child.
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

/** Linked children for the current (parent) user, for the Settings "Linked children" card. */
export const getMyLinkedChildren = query({
	args: {},
	returns: v.array(
		v.object({
			childProfileId: v.id('profiles'),
			firstName: v.union(v.string(), v.null()),
			lastName: v.union(v.string(), v.null()),
			username: v.union(v.string(), v.null()),
			notificationEmail: v.union(v.string(), v.null())
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
				notificationEmail: child.notificationEmail ?? null
			});
		}
		return children;
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

		const link = await ctx.db
			.query('parentLinks')
			.withIndex('by_parent_and_child', (q) =>
				q.eq('parentProfileId', args.parentProfileId).eq('childProfileId', profile._id)
			)
			.unique();
		if (link) {
			await ctx.db.delete(link._id);
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
		for (const consent of consents) {
			if (consent.unlinkedAt !== undefined) continue;
			const isThisParent = consent.parentProfileId
				? consent.parentProfileId === args.parentProfileId
				: normalizedParentEmail !== null &&
					normalizeEmail(consent.parentEmail) === normalizedParentEmail;
			if (!isThisParent) continue;
			await ctx.db.patch(consent._id, { unlinkedAt: now, updatedAt: now });
		}
		return { success: true };
	}
});

// ---------------------------------------------------------------------------------------------
// Child notification email
// ---------------------------------------------------------------------------------------------

// Deliberately strict-but-simple: one "@", no whitespace, a dot in the domain. The address is
// only ever used as a Resend recipient, so a false negative costs a retry, a false positive an
// undeliverable email — neither is a security concern.
const isPlausibleEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

/**
 * Sets (or clears, with `email: null`) the real address a child's NON-critical notification
 * emails go to — club/project chat activity and other high-tier kinds — instead of the parent
 * (see profiles.notificationEmail in schema.ts and notifications.resolveEmailRecipient).
 *
 * This is the one parentAccounts mutation that names a childProfileId, and it is NOT an "act as
 * the child" path (see the module header and the structural test in parentAccounts.spec.ts):
 * it writes a parent-owned setting onto the child's profile and runs nothing under the child's
 * identity. Only the linked parent may call it, because a child cannot consent to receiving
 * email on their own — the parent does so on their behalf, and who/when is recorded.
 */
export const setChildNotificationEmail = mutation({
	args: {
		childProfileId: v.id('profiles'),
		email: v.union(v.string(), v.null())
	},
	returns: v.object({ notificationEmail: v.union(v.string(), v.null()) }),
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

		const email = args.email === null ? null : normalizeEmail(args.email);
		if (email !== null) {
			if (!isPlausibleEmail(email) || email.endsWith(`@${CHILD_EMAIL_DOMAIN}`)) {
				throw new ConvexError('Please enter a valid email address');
			}
		}

		const now = Date.now();
		await ctx.db.patch(child._id, {
			notificationEmail: email ?? undefined,
			notificationEmailSetAt: email ? now : undefined,
			notificationEmailSetByProfileId: email ? parentProfile._id : undefined,
			updatedAt: now
		});
		return { notificationEmail: email };
	}
});
