import { ConvexError, v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { mutation, query } from './_generated/server';
import { hasPermissionForProfile, requireIdentity, requireProfile } from './permissions';
import { isProjectArchived } from './projectsModel';

const MAX_MESSAGE_LENGTH = 1_000;
const DEFAULT_MESSAGE_LIMIT = 50;
type Ctx = QueryCtx | MutationCtx;
type SendBlockedReason = 'archived' | 'not_participant' | null;
type RoomAccess = { canRead: boolean; canSend: boolean; sendBlockedReason: SendBlockedReason };

const getClubAccess = async (
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
	const links = await ctx.db
		.query('projectClubs')
		.withIndex('by_project', (q) => q.eq('projectId', projectId))
		.collect();

	for (const link of links) {
		const memberships = await ctx.db
			.query('clubMembers')
			.withIndex('by_club_and_profile', (q) =>
				q.eq('clubId', link.clubId).eq('profileId', profileId)
			)
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

const getProjectAccess = async (
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
		!archived &&
		(memberships.some((membership) => !membership.leftAt) || observerAccess.canSend);

	let sendBlockedReason: SendBlockedReason = null;
	if (!canSend && canRead) {
		sendBlockedReason = archived ? 'archived' : 'not_participant';
	}

	return { canRead, canSend, sendBlockedReason };
};

const getClubApplicationAccess = async (
	ctx: Ctx,
	clubApplicationId: Id<'clubApplications'>,
	profileId: Id<'profiles'>
): Promise<RoomAccess> => {
	const application = await ctx.db.get(clubApplicationId);
	if (!application) {
		return { canRead: false, canSend: false, sendBlockedReason: null };
	}
	if (application.applicantProfileId === profileId) {
		return { canRead: true, canSend: true, sendBlockedReason: null };
	}

	const review = await ctx.db
		.query('applicationReviews')
		.withIndex('by_application_id_and_reviewer_profile_id', (q) =>
			q.eq('applicationId', clubApplicationId).eq('reviewerProfileId', profileId)
		)
		.first();
	return {
		canRead: Boolean(review),
		canSend: Boolean(review),
		sendBlockedReason: null
	};
};

const getJoinRequestAccess = async (
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

const getRoomAccess = async (
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

const requireRoomAccess = async (
	ctx: Ctx,
	roomId: Id<'rooms'>,
	profileId: Id<'profiles'>,
	accessType: 'read' | 'send'
) => {
	const room = await ctx.db.get(roomId);
	if (!room) {
		throw new ConvexError('Room not found');
	}

	const access = await getRoomAccess(ctx, room, profileId);
	if (!access.canRead) {
		throw new ConvexError('You cannot access this chat');
	}
	if (accessType === 'send' && !access.canSend) {
		throw new ConvexError('You can no longer send messages in this chat');
	}

	return room;
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

const addRoomByClub = async (
	ctx: QueryCtx,
	rooms: Map<Id<'rooms'>, Doc<'rooms'>>,
	clubId: Id<'clubs'>
) => {
	const room = await ctx.db
		.query('rooms')
		.withIndex('by_club_id', (q) => q.eq('clubId', clubId))
		.first();
	if (room) rooms.set(room._id, room);
};

const addRoomByProject = async (
	ctx: QueryCtx,
	rooms: Map<Id<'rooms'>, Doc<'rooms'>>,
	projectId: Id<'projects'>
) => {
	const room = await ctx.db
		.query('rooms')
		.withIndex('by_project_id', (q) => q.eq('projectId', projectId))
		.first();
	if (room) rooms.set(room._id, room);
};

const addRoomByClubApplication = async (
	ctx: QueryCtx,
	rooms: Map<Id<'rooms'>, Doc<'rooms'>>,
	clubApplicationId: Id<'clubApplications'>
) => {
	const room = await ctx.db
		.query('rooms')
		.withIndex('by_club_application_id', (q) => q.eq('clubApplicationId', clubApplicationId))
		.first();
	if (room) rooms.set(room._id, room);
};

const addRoomByJoinRequest = async (
	ctx: QueryCtx,
	rooms: Map<Id<'rooms'>, Doc<'rooms'>>,
	joinRequestId: Id<'joinRequests'>
) => {
	const room = await ctx.db
		.query('rooms')
		.withIndex('by_join_request_id', (q) => q.eq('joinRequestId', joinRequestId))
		.first();
	if (room) rooms.set(room._id, room);
};

export const listRoomSummaries = query({
	args: {},
	handler: async (ctx) => {
		const identity = await requireIdentity(ctx);
		const profile = await requireProfile(ctx, identity.subject);
		const rooms = new Map<Id<'rooms'>, Doc<'rooms'>>();

		const clubMemberships = await ctx.db
			.query('clubMembers')
			.withIndex('by_profile', (q) => q.eq('profileId', profile._id))
			.collect();
		for (const membership of clubMemberships) {
			await addRoomByClub(ctx, rooms, membership.clubId);

			const role = await ctx.db.get(membership.roleId);
			if (role?.permissions.includes('project:read')) {
				const links = await ctx.db
					.query('projectClubs')
					.withIndex('by_club', (q) => q.eq('clubId', membership.clubId))
					.collect();
				for (const link of links) {
					await addRoomByProject(ctx, rooms, link.projectId);
				}
			}

			// Only current (not-left) Guides surface join-request chats for their club: a Guide
			// who has left shouldn't keep seeing new applicants' rooms, though history for chats
			// they already participated in is preserved by getJoinRequestAccess's own check.
			if (!membership.leftAt && role?.permissions.includes('club_join_request:decide')) {
				const joinRequests = await ctx.db
					.query('joinRequests')
					.withIndex('by_club', (q) => q.eq('clubId', membership.clubId))
					.collect();
				for (const joinRequest of joinRequests) {
					await addRoomByJoinRequest(ctx, rooms, joinRequest._id);
				}
			}
		}

		const projectMemberships = await ctx.db
			.query('projectMembers')
			.withIndex('by_profile', (q) => q.eq('profileId', profile._id))
			.collect();
		for (const membership of projectMemberships) {
			await addRoomByProject(ctx, rooms, membership.projectId);
		}

		const applications = await ctx.db
			.query('clubApplications')
			.withIndex('by_applicant_profile_id', (q) => q.eq('applicantProfileId', profile._id))
			.collect();
		for (const application of applications) {
			await addRoomByClubApplication(ctx, rooms, application._id);
		}

		const reviews = await ctx.db
			.query('applicationReviews')
			.withIndex('by_reviewer_profile_id', (q) => q.eq('reviewerProfileId', profile._id))
			.collect();
		for (const review of reviews) {
			await addRoomByClubApplication(ctx, rooms, review.applicationId);
		}

		// Own join requests: surfaced regardless of club membership, so a user with no club
		// membership at all still sees their pending/decided join-request chats (PRD 6.8).
		const ownJoinRequests = await ctx.db
			.query('joinRequests')
			.withIndex('by_requester_profile_id', (q) => q.eq('requesterProfileId', profile._id))
			.collect();
		for (const joinRequest of ownJoinRequests) {
			await addRoomByJoinRequest(ctx, rooms, joinRequest._id);
		}

		const summaries: Array<{
			roomId: Id<'rooms'>;
			roomName: string;
			contextType: Doc<'rooms'>['contextType'];
			lastMessagePreview: string | null;
			lastMessageAt: number;
			canSend: boolean;
			sendBlockedReason: SendBlockedReason;
		}> = [];

		for (const room of rooms.values()) {
			const access = await getRoomAccess(ctx, room, profile._id);
			if (!access.canRead) continue;

			const latestMessage = await ctx.db
				.query('messages')
				.withIndex('by_room', (q) => q.eq('roomId', room._id))
				.order('desc')
				.first();
			summaries.push({
				roomId: room._id,
				roomName: await getRoomName(ctx, room),
				contextType: room.contextType,
				lastMessagePreview: latestMessage?.content ?? null,
				lastMessageAt: latestMessage?._creationTime ?? room._creationTime,
				canSend: access.canSend,
				sendBlockedReason: access.sendBlockedReason
			});
		}

		return summaries.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
	}
});

export const listMessages = query({
	args: {
		roomId: v.id('rooms'),
		limit: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const profile = await requireProfile(ctx, identity.subject);
		await requireRoomAccess(ctx, args.roomId, profile._id, 'read');

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

export const sendMessage = mutation({
	args: {
		roomId: v.id('rooms'),
		content: v.string()
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const profile = await requireProfile(ctx, identity.subject);
		await requireRoomAccess(ctx, args.roomId, profile._id, 'send');

		const content = args.content.trim();
		if (!content) {
			throw new ConvexError('Message content is required');
		}
		if (content.length > MAX_MESSAGE_LENGTH) {
			throw new ConvexError(`Messages cannot exceed ${MAX_MESSAGE_LENGTH} characters`);
		}

		const messageId = await ctx.db.insert('messages', {
			roomId: args.roomId,
			profileId: profile._id,
			content
		});
		return await ctx.db.get(messageId);
	}
});
