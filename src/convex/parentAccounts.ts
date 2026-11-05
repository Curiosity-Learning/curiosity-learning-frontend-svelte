import { ConvexError, v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { mutation, query } from './_generated/server';
import { getAuthUserEmail } from './authEmail';
import { CHILD_EMAIL_DOMAIN } from './childAccounts';
import { getRoomAccess, getRoomName } from './chatModel';
import {
	CHILD_EMAIL_VERIFICATION_RATE_LIMIT,
	childEmailVerificationRateLimitKey,
	invalidateChildEmailVerifications,
	issueChildEmailVerification,
	scheduleRoutingChangedNotice
} from './childEmailVerification';
import { getParentNotificationSettings } from './notificationRouting';
import { getProfileByAuthUserId, requireIdentity, requireProfile } from './permissions';
import { isRateLimited, recordRateLimitAttempt } from './rateLimiting';
import { ROUTING_CHANGE_MAX_SESSION_AGE_MS, requireFreshSession } from './sessionFreshness';
import {
	NOTIFICATION_EMAIL_IS_PARENT,
	RESEND_LIMIT_REACHED
} from '../lib/domain/child-notification-email';
import { canViewProject } from './projectsModel';

type Ctx = QueryCtx | MutationCtx;

const normalizeEmail = (value: string) => value.trim().toLowerCase();

// ---------------------------------------------------------------------------------------------
// PRD 2.4/6.1.10 (CL-703): "Parent Accounts & View as Child".
//
// Design note (v1 simplification, documented here + in the Fibery-facing report): "View as
// Child" is a DEDICATED READ-ONLY SURFACE (see /child/[childProfileId] routes), not full app
// impersonation. A parent gets server-verified read access to the child's clubs+roles,
// projects (current/showcase), recent updates, and chat rooms/message history — exactly the
// PRD's "see clubs, projects, activity, messages; report issues; change nothing" monitoring
// intent — without ever running the child's write paths under the parent's identity. Building
// full per-route impersonation would multiply the testing surface (every mutation would need an
// explicit "no, not even for a viewing parent" check) for no PRD-required benefit.
//
// Linking: a `parentLinks` row is the source of truth for "can this parent read this child's
// data". Links are created at consent-approval time: `childSignup.approveConsent` finds or
// creates the Better Auth user + profile for `parentEmail` and inserts the link (via
// `ensureParentLink`) in the same mutation, so a parent can open /child/[id] straight from an
// email. That account is the one the parent later signs in to: an email+password sign-in uses it
// directly (after "Forgot password?" sets a password), and Better Auth's default account linking
// attaches a Google sign-in with the same verified email to the existing user rather than
// creating a new one (we never disable account linking in auth.ts).
//
// `syncParentLinks` remains as a lazy *claim* fallback, run on Settings and /child/[id] loads: it
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
		const identity = await requireIdentity(ctx);
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
			username: v.union(v.string(), v.null())
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
				username: child.username ?? null
			});
		}
		return children;
	}
});

/**
 * Edge case 14: where a club-less account lands instead of /new-club. A parent's account exists
 * because they approved a child, not to start a club, so the (app) layout, `/` and `/club` send
 * an account with no clubs but with a `parentLinks` row to that child's page
 * (lib/auth/no-club-allowlist.ts `clubLessLandingPath`). The earliest link wins, so the landing
 * is stable for parents of several children (Settings lists them all). Null for signed-out
 * callers and accounts without links, so the gates can call it unconditionally.
 */
export const getMyFirstLinkedChildId = query({
	args: {},
	returns: v.union(v.id('profiles'), v.null()),
	handler: async (ctx) => {
		const identity = await ctx.auth.getUserIdentity();
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
// Read-only child queries (parent side). Every one of these:
//   1. Resolves the CALLER's own profile (never trusts a client-passed parent id).
//   2. Verifies a `parentLinks` row exists between the caller and `childProfileId`.
//   3. Computes everything AS THE CHILD would see it (not filtered for the parent-as-viewer) —
//      the PRD intent is "the parent sees what the child sees", not a re-application of the
//      normal cross-profile visibility rules from the parent's own vantage point. This is why
//      these do not simply delegate to `profiles.getById`/`chat.listRoomSummaries` (which are
//      viewer-scoped to whoever is calling) — visibility here must be computed against the
//      CHILD's own memberships/authUserId, then handed to the parent as a read-only projection.
// The parent-side WRITES that name a child (setChildNotificationEmail,
// setParentNotificationSettings) write parent-owned settings, never act as the child, and call
// requireParentLink first. The structural test at the bottom of parentAccounts.spec.ts enforces
// that rule for every public mutation that takes a profile id (review S13).
// ---------------------------------------------------------------------------------------------

const UPDATES_PREVIEW_LIMIT = 30;

export const getChildOverview = query({
	args: { childProfileId: v.id('profiles') },
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const parentProfile = await requireProfile(ctx, identity.subject);
		await requireParentLink(ctx, parentProfile._id, args.childProfileId);

		const child = await ctx.db.get(args.childProfileId);
		if (!child) {
			throw new ConvexError('Child profile not found');
		}
		const childAuthUserId = child.authUserId;

		// Clubs the child is currently active in, with role — mirrors profiles.getById's own-view
		// shape (excludes left memberships and CoC groups).
		const memberships = (
			await ctx.db
				.query('clubMembers')
				.withIndex('by_profile', (q) => q.eq('profileId', child._id))
				.collect()
		).filter((membership) => !membership.leftAt);

		const clubs: Array<{
			clubId: Id<'clubs'>;
			clubName: string;
			roleKey: 'guide' | 'learner' | null;
			roleName: string | null;
		}> = [];
		for (const membership of memberships) {
			const club = await ctx.db.get(membership.clubId);
			if (!club || club.kind === 'coc') continue;
			const role = await ctx.db.get(membership.roleId);
			clubs.push({
				clubId: club._id,
				clubName: club.name,
				roleKey: role?.key ?? null,
				roleName: role?.name ?? null
			});
		}

		// Projects: computed AS THE CHILD (canViewProject against the child's own authUserId, not
		// the parent's) — the child is always "isSelf" from their own vantage point, so every
		// project they're a member of is included, split current/showcase exactly as the child's
		// own profile page would show it to them.
		const projectMemberships = await ctx.db
			.query('projectMembers')
			.withIndex('by_profile', (q) => q.eq('profileId', child._id))
			.collect();

		type ProjectEntry = {
			projectId: Id<'projects'>;
			name: string;
			description: string | null;
			dueDate: number;
			archivedAt: number | null;
			coverImageMediaAssetId: Id<'mediaAssets'> | null;
			section: 'current' | 'showcase';
		};
		const projectEntries: ProjectEntry[] = [];
		const viewableProjectIds = new Set<Id<'projects'>>();
		const seenProjectIds = new Set<Id<'projects'>>();

		for (const membership of projectMemberships) {
			if (seenProjectIds.has(membership.projectId)) continue;
			seenProjectIds.add(membership.projectId);

			const project = await ctx.db.get(membership.projectId);
			if (!project) continue;

			// The child is always able to view a project they're a member of (mirrors
			// profiles.getById's isSelf shortcut) — canViewProject is only consulted for parity/
			// documentation purposes here since membership already guarantees visibility.
			const canView = await canViewProject(ctx, project._id, childAuthUserId);
			if (!canView) continue;
			viewableProjectIds.add(project._id);

			const memberIsDoneOrLeft = Boolean(membership.doneDate) || Boolean(membership.leftAt);
			const isShowcase = Boolean(project.archivedAt) || memberIsDoneOrLeft;

			projectEntries.push({
				projectId: project._id,
				name: project.name,
				description: project.description ?? null,
				dueDate: project.dueDate,
				archivedAt: project.archivedAt ?? null,
				coverImageMediaAssetId: project.coverImageMediaAssetId ?? null,
				section: isShowcase ? 'showcase' : 'current'
			});
		}
		projectEntries.sort((a, b) => b.dueDate - a.dueDate);

		// Recent updates authored by the child, filtered to the same as-the-child visible project
		// set (same shape as profiles.getById).
		const authoredUpdates = await ctx.db
			.query('updates')
			.withIndex('by_created_by_profile_and_created', (q) => q.eq('createdByProfileId', child._id))
			.order('desc')
			.take(UPDATES_PREVIEW_LIMIT * 4);

		const updates: Array<{
			updateId: Id<'updates'>;
			projectId: Id<'projects'> | null;
			projectName: string | null;
			content: string;
			createdAt: number;
			mediaAssetIds: Id<'mediaAssets'>[];
		}> = [];

		for (const update of authoredUpdates) {
			if (updates.length >= UPDATES_PREVIEW_LIMIT) break;
			if (update.takedown) continue;
			if (!update.projectId) continue;

			if (!viewableProjectIds.has(update.projectId)) {
				const canView = await canViewProject(ctx, update.projectId, childAuthUserId);
				if (!canView) continue;
				viewableProjectIds.add(update.projectId);
			}

			const project = await ctx.db.get(update.projectId);
			const files = await ctx.db
				.query('updateFiles')
				.withIndex('by_update', (q) => q.eq('updateId', update._id))
				.collect();
			updates.push({
				updateId: update._id,
				projectId: update.projectId,
				projectName: project?.name ?? null,
				content: update.content,
				createdAt: update.createdAt,
				mediaAssetIds: files.map((file) => file.mediaAssetId)
			});
		}

		return {
			childProfileId: child._id,
			firstName: child.firstName ?? null,
			lastName: child.lastName ?? null,
			username: child.username ?? null,
			profileImageMediaAssetId: child.profileImageMediaAssetId ?? null,
			// Pending until notificationEmailVerifiedAt is set (see setChildNotificationEmail).
			notificationEmail: child.notificationEmail ?? null,
			notificationEmailVerifiedAt: child.notificationEmailVerifiedAt ?? null,
			notificationEmailSetAt: child.notificationEmailSetAt ?? null,
			notificationEmailVerified:
				Boolean(child.notificationEmail) && child.notificationEmailVerifiedAt !== undefined,
			// The CALLER's own per-child email choices (setParentNotificationSettings).
			parentNotificationSettings: await getParentNotificationSettings(
				ctx,
				parentProfile._id,
				child._id
			),
			clubs,
			projects: {
				current: projectEntries.filter((entry) => entry.section === 'current'),
				showcase: projectEntries.filter((entry) => entry.section === 'showcase')
			},
			updates
		};
	}
});

// Gathers the rooms the CHILD could plausibly belong to (their club/project memberships, club
// applications, and join requests), then re-checks each one's `canRead` via `chatModel.ts`'s
// shared `getRoomAccess` — the SAME club/project/application/join-request access rules `chat.ts`
// uses, just evaluated against the child's profile id instead of whichever profile is calling.
// `canSend`/`sendBlockedReason` are irrelevant here and deliberately dropped: a parent viewing
// through this surface can never send as their child (see the module doc comment above).
const listChildReadableRoomIds = async (
	ctx: Ctx,
	child: Doc<'profiles'>
): Promise<Set<Id<'rooms'>>> => {
	const candidateRooms = new Map<Id<'rooms'>, Doc<'rooms'>>();
	const addRoom = (room: Doc<'rooms'> | null) => {
		if (room) candidateRooms.set(room._id, room);
	};

	const clubMemberships = await ctx.db
		.query('clubMembers')
		.withIndex('by_profile', (q) => q.eq('profileId', child._id))
		.collect();
	for (const membership of clubMemberships) {
		const clubRoom = await ctx.db
			.query('rooms')
			.withIndex('by_club_id', (q) => q.eq('clubId', membership.clubId))
			.first();
		addRoom(clubRoom);

		const role = await ctx.db.get(membership.roleId);
		if (role?.permissions.includes('project:read')) {
			const attributionRows = await ctx.db
				.query('projectAttributions')
				.withIndex('by_club', (q) => q.eq('clubId', membership.clubId))
				.collect();
			for (const projectId of new Set(attributionRows.map((row) => row.projectId))) {
				const projectRoom = await ctx.db
					.query('rooms')
					.withIndex('by_project_id', (q) => q.eq('projectId', projectId))
					.first();
				addRoom(projectRoom);
			}
		}

		if (!membership.leftAt && role?.permissions.includes('club_join_request:decide')) {
			const joinRequests = await ctx.db
				.query('joinRequests')
				.withIndex('by_club', (q) => q.eq('clubId', membership.clubId))
				.collect();
			for (const joinRequest of joinRequests) {
				const joinRequestRoom = await ctx.db
					.query('rooms')
					.withIndex('by_join_request_id', (q) => q.eq('joinRequestId', joinRequest._id))
					.first();
				addRoom(joinRequestRoom);
			}
		}
	}

	const projectMemberships = await ctx.db
		.query('projectMembers')
		.withIndex('by_profile', (q) => q.eq('profileId', child._id))
		.collect();
	for (const membership of projectMemberships) {
		const projectRoom = await ctx.db
			.query('rooms')
			.withIndex('by_project_id', (q) => q.eq('projectId', membership.projectId))
			.first();
		addRoom(projectRoom);
	}

	const applications = await ctx.db
		.query('clubApplications')
		.withIndex('by_applicant_profile_id', (q) => q.eq('applicantProfileId', child._id))
		.collect();
	for (const application of applications) {
		const applicationRoom = await ctx.db
			.query('rooms')
			.withIndex('by_club_application_id', (q) => q.eq('clubApplicationId', application._id))
			.first();
		addRoom(applicationRoom);
	}

	const ownJoinRequests = await ctx.db
		.query('joinRequests')
		.withIndex('by_requester_profile_id', (q) => q.eq('requesterProfileId', child._id))
		.collect();
	for (const joinRequest of ownJoinRequests) {
		const joinRequestRoom = await ctx.db
			.query('rooms')
			.withIndex('by_join_request_id', (q) => q.eq('joinRequestId', joinRequest._id))
			.first();
		addRoom(joinRequestRoom);
	}

	const roomIds = new Set<Id<'rooms'>>();
	for (const room of candidateRooms.values()) {
		const access = await getRoomAccess(ctx, room, child._id);
		if (access.canRead) {
			roomIds.add(room._id);
		}
	}
	return roomIds;
};

/** Read-only room list, as visible to the child. No `canSend`/composer affordance at all. */
export const listChildRooms = query({
	args: { childProfileId: v.id('profiles') },
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const parentProfile = await requireProfile(ctx, identity.subject);
		await requireParentLink(ctx, parentProfile._id, args.childProfileId);

		const child = await ctx.db.get(args.childProfileId);
		if (!child) {
			throw new ConvexError('Child profile not found');
		}

		const roomIds = await listChildReadableRoomIds(ctx, child);
		const summaries: Array<{
			roomId: Id<'rooms'>;
			roomName: string;
			contextType: Doc<'rooms'>['contextType'];
			lastMessagePreview: string | null;
			lastMessageAt: number;
		}> = [];

		for (const roomId of roomIds) {
			const room = await ctx.db.get(roomId);
			if (!room) continue;
			const latestMessage = await ctx.db
				.query('messages')
				.withIndex('by_room', (q) => q.eq('roomId', roomId))
				.order('desc')
				.first();
			summaries.push({
				roomId: room._id,
				roomName: await getRoomName(ctx, room),
				contextType: room.contextType,
				lastMessagePreview: latestMessage?.content ?? null,
				lastMessageAt: latestMessage?._creationTime ?? room._creationTime
			});
		}

		return summaries.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
	}
});

const DEFAULT_MESSAGE_LIMIT = 50;

/** Read-only message history for one room, gated by the CHILD's own room access. */
export const listChildMessages = query({
	args: {
		childProfileId: v.id('profiles'),
		roomId: v.id('rooms'),
		limit: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const parentProfile = await requireProfile(ctx, identity.subject);
		await requireParentLink(ctx, parentProfile._id, args.childProfileId);

		const child = await ctx.db.get(args.childProfileId);
		if (!child) {
			throw new ConvexError('Child profile not found');
		}

		const roomIds = await listChildReadableRoomIds(ctx, child);
		if (!roomIds.has(args.roomId)) {
			throw new ConvexError('This chat is not accessible for this child');
		}

		const requestedLimit = Math.floor(args.limit ?? DEFAULT_MESSAGE_LIMIT);
		const limit = Math.max(requestedLimit, 1);
		const records = await ctx.db
			.query('messages')
			.withIndex('by_room', (q) => q.eq('roomId', args.roomId))
			.order('desc')
			.take(limit + 1);
		const hasMore = records.length > limit;
		return {
			messages: records.slice(0, limit).reverse(),
			hasMore
		};
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
