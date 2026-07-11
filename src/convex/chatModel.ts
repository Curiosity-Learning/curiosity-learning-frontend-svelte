import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { hasPermissionForProfile } from './permissions';
import { isProjectArchived, listAttributedClubIds } from './projectsModel';

type Ctx = QueryCtx | MutationCtx;
export type SendBlockedReason = 'archived' | 'not_participant' | null;
export type RoomAccess = { canRead: boolean; canSend: boolean; sendBlockedReason: SendBlockedReason };

// ---------------------------------------------------------------------------------------------
// Room access rules (PRD 6.9-6.11 chat surfaces). Shared by `chat.ts` (evaluated for whichever
// profile is calling, with a full read+send answer) and `parentAccounts.ts`'s read-only "View as
// Child" chat surface (evaluated for the CHILD's profile id, using only `canRead` — a parent can
// never send as their child, so `canSend`/`sendBlockedReason` are simply ignored there).
// ---------------------------------------------------------------------------------------------

export const getClubAccess = async (
	ctx: Ctx,
	clubId: Id<'clubs'>,
	profileId: Id<'profiles'>
): Promise<RoomAccess> => {
	const memberships = await ctx.db
		.query('clubMembers')
		.withIndex('by_club_and_profile', (q) => q.eq('clubId', clubId).eq('profileId', profileId))
		.collect();
	const canRead = memberships.length > 0;
	const canSend = memberships.some((membership) => !membership.leftAt);
	return {
		canRead,
		canSend,
		sendBlockedReason: !canSend && canRead ? 'not_participant' : null
	};
};

const getProjectObserverAccess = async (
	ctx: Ctx,
	projectId: Id<'projects'>,
	profileId: Id<'profiles'>
): Promise<{ canRead: boolean; canSend: boolean }> => {
	const access = { canRead: false, canSend: false };
	const attributedClubIds = await listAttributedClubIds(ctx, projectId);

	for (const clubId of attributedClubIds) {
		const memberships = await ctx.db
			.query('clubMembers')
			.withIndex('by_club_and_profile', (q) => q.eq('clubId', clubId).eq('profileId', profileId))
			.collect();
		for (const membership of memberships) {
			const role = await ctx.db.get(membership.roleId);
			if (!role?.permissions.includes('project:read')) {
				continue;
			}
			access.canRead = true;
			if (!membership.leftAt) {
				access.canSend = true;
			}
		}
	}

	return access;
};

export const getProjectAccess = async (
	ctx: Ctx,
	projectId: Id<'projects'>,
	profileId: Id<'profiles'>
): Promise<RoomAccess> => {
	const memberships = await ctx.db
		.query('projectMembers')
		.withIndex('by_project_and_profile', (q) =>
			q.eq('projectId', projectId).eq('profileId', profileId)
		)
		.collect();
	const observerAccess = await getProjectObserverAccess(ctx, projectId, profileId);
	const canRead = memberships.length > 0 || observerAccess.canRead;
	const archived = await isProjectArchived(ctx, projectId);
	const canSend =
		!archived && (memberships.some((membership) => !membership.leftAt) || observerAccess.canSend);

	let sendBlockedReason: SendBlockedReason = null;
	if (!canSend && canRead) {
		sendBlockedReason = archived ? 'archived' : 'not_participant';
	}

	return { canRead, canSend, sendBlockedReason };
};

// Once an application is decided, the chat stays readable for history but the composer closes:
// rejected applications are read-only (the applicant may want to ask why), and finalized ones are
// closed with a "your club is live" banner instead (see CL-710).
const isClubApplicationChatSendable = (status: Doc<'clubApplications'>['status']) =>
	status !== 'rejected' && status !== 'finalized';

export const getClubApplicationAccess = async (
	ctx: Ctx,
	clubApplicationId: Id<'clubApplications'>,
	profileId: Id<'profiles'>
): Promise<RoomAccess> => {
	const application = await ctx.db.get(clubApplicationId);
	if (!application) {
		return { canRead: false, canSend: false, sendBlockedReason: null };
	}
	const sendable = isClubApplicationChatSendable(application.status);
	if (application.applicantProfileId === profileId) {
		return {
			canRead: true,
			canSend: sendable,
			sendBlockedReason: sendable ? null : 'not_participant'
		};
	}

	const review = await ctx.db
		.query('applicationReviews')
		.withIndex('by_application_id_and_reviewer_profile_id', (q) =>
			q.eq('applicationId', clubApplicationId).eq('reviewerProfileId', profileId)
		)
		.first();
	const canRead = Boolean(review);
	return {
		canRead,
		canSend: canRead && sendable,
		sendBlockedReason: canRead && !sendable ? 'not_participant' : null
	};
};

export const getJoinRequestAccess = async (
	ctx: Ctx,
	joinRequestId: Id<'joinRequests'>,
	profileId: Id<'profiles'>
): Promise<RoomAccess> => {
	const joinRequest = await ctx.db.get(joinRequestId);
	if (!joinRequest) {
		return { canRead: false, canSend: false, sendBlockedReason: null };
	}

	const canSend = joinRequest.status === 'pending';
	if (joinRequest.requesterProfileId === profileId) {
		return { canRead: true, canSend, sendBlockedReason: null };
	}

	// Any current Guide of the club can read/send, mirroring how any reviewer can act on a
	// club application chat. Access is derived (no participants table), same pattern as
	// `getClubApplicationAccess`.
	const allowed = await hasPermissionForProfile(
		ctx,
		joinRequest.clubId,
		profileId,
		'club_join_request:decide'
	);
	return { canRead: allowed, canSend: allowed && canSend, sendBlockedReason: null };
};

export const getRoomAccess = async (
	ctx: Ctx,
	room: Doc<'rooms'>,
	profileId: Id<'profiles'>
): Promise<RoomAccess> => {
	switch (room.contextType) {
		case 'club':
			return await getClubAccess(ctx, room.clubId, profileId);
		case 'project':
			return await getProjectAccess(ctx, room.projectId, profileId);
		case 'clubApplication':
			return await getClubApplicationAccess(ctx, room.clubApplicationId, profileId);
		case 'joinRequest':
			return await getJoinRequestAccess(ctx, room.joinRequestId, profileId);
	}
};

export const getRoomName = async (ctx: Ctx, room: Doc<'rooms'>) => {
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

export const ensureClubRoom = async (ctx: MutationCtx, clubId: Id<'clubs'>) => {
	const existing = await ctx.db
		.query('rooms')
		.withIndex('by_club_id', (q) => q.eq('clubId', clubId))
		.first();
	if (existing) {
		return existing._id;
	}

	return await ctx.db.insert('rooms', {
		contextType: 'club',
		clubId
	});
};

export const ensureProjectRoom = async (ctx: MutationCtx, projectId: Id<'projects'>) => {
	const existing = await ctx.db
		.query('rooms')
		.withIndex('by_project_id', (q) => q.eq('projectId', projectId))
		.first();
	if (existing) {
		return existing._id;
	}

	return await ctx.db.insert('rooms', {
		contextType: 'project',
		projectId
	});
};

export const ensureClubApplicationRoom = async (
	ctx: MutationCtx,
	clubApplicationId: Id<'clubApplications'>
) => {
	const existing = await ctx.db
		.query('rooms')
		.withIndex('by_club_application_id', (q) => q.eq('clubApplicationId', clubApplicationId))
		.first();
	if (existing) {
		return existing._id;
	}

	return await ctx.db.insert('rooms', {
		contextType: 'clubApplication',
		clubApplicationId
	});
};

export const ensureJoinRequestRoom = async (
	ctx: MutationCtx,
	joinRequestId: Id<'joinRequests'>
) => {
	const existing = await ctx.db
		.query('rooms')
		.withIndex('by_join_request_id', (q) => q.eq('joinRequestId', joinRequestId))
		.first();
	if (existing) {
		return existing._id;
	}

	return await ctx.db.insert('rooms', {
		contextType: 'joinRequest',
		joinRequestId
	});
};
