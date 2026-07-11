import { ConvexError, v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { mutation, query } from './_generated/server';
import { getAuthUserEmail } from './authEmail';
import { requireIdentity, requireProfile } from './permissions';
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
// data". Links are NOT created at consent-approval time (parentChildConsents.approvedAt) because
// the consent flow's optional "create a parent account with this email" step may not run, or the
// resulting Better Auth user may not match the CURRENT caller (e.g. they sign in with a
// different provider under the same email later). Instead, links are *claimed* lazily: whenever
// an authenticated user loads Settings, `syncParentLinks` looks up every APPROVED consent row
// whose `parentEmail` matches the caller's own Better Auth email (via `getAuthUserEmail`, the
// same adapter helper `notificationsModel`/`notifications.ts` use) and materializes any missing
// `parentLinks` row. This makes the mechanism resilient to re-signups/account recovery and keeps
// it a pure derivation from `parentChildConsents`, which remains the legal record of consent.
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
export const isAtLeast16FromDateOfBirth = (dateOfBirth: string | undefined, now: number): boolean => {
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
 * Lazily materializes `parentLinks` rows for the CURRENT authenticated user, one per APPROVED
 * `parentChildConsents` row whose `parentEmail` matches the caller's own Better Auth email
 * (case-insensitive). Idempotent — safe to call on every Settings page load (see
 * `getMyLinkedChildren`'s caller in the settings page, which fires this once per mount).
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
		).filter((consent) => consent.status === 'approved');

		let linkedCount = 0;
		for (const consent of approvedConsents) {
			const existing = await ctx.db
				.query('parentLinks')
				.withIndex('by_parent_and_child', (q) =>
					q.eq('parentProfileId', profile._id).eq('childProfileId', consent.childProfileId)
				)
				.unique();
			if (existing) continue;

			await ctx.db.insert('parentLinks', {
				parentProfileId: profile._id,
				childProfileId: consent.childProfileId,
				createdAt: Date.now()
			});
			linkedCount += 1;
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
		if (!link) {
			return { success: true };
		}

		await ctx.db.delete(link._id);
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
// No mutation in this module (or anywhere else in the codebase) accepts a `childProfileId` — see
// the structural test in parentAccounts.spec.ts asserting no mutation validator has that field.
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
			.withIndex('by_created_by_profile_and_created', (q) =>
				q.eq('createdByProfileId', child._id)
			)
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
			clubs,
			projects: {
				current: projectEntries.filter((entry) => entry.section === 'current'),
				showcase: projectEntries.filter((entry) => entry.section === 'showcase')
			},
			updates
		};
	}
});

// Re-derives room access using the CHILD's own profile id/authUserId, reusing the same
// club/project/application/join-request access rules `chat.ts` uses — just evaluated for the
// child rather than for whichever profile is calling. Duplicated (rather than imported) from
// `chat.ts` because those helpers are not exported there; kept intentionally minimal (read-only,
// no send-access computation) since parents can never send as the child.
const listChildReadableRoomIds = async (
	ctx: Ctx,
	child: Doc<'profiles'>
): Promise<Set<Id<'rooms'>>> => {
	const roomIds = new Set<Id<'rooms'>>();
	const addRoom = (room: Doc<'rooms'> | null) => {
		if (room) roomIds.add(room._id);
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

	return roomIds;
};

const getRoomName = async (ctx: Ctx, room: Doc<'rooms'>) => {
	switch (room.contextType) {
		case 'club':
			return (await ctx.db.get(room.clubId))?.name ?? 'Club chat';
		case 'project':
			return (await ctx.db.get(room.projectId))?.name ?? 'Project chat';
		case 'clubApplication':
			return (await ctx.db.get(room.clubApplicationId))?.name ?? 'Club application chat';
		case 'joinRequest': {
			const joinRequest = await ctx.db.get(room.joinRequestId);
			const club = joinRequest ? await ctx.db.get(joinRequest.clubId) : null;
			return club ? `${club.name} join request` : 'Join request chat';
		}
	}
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
