import { ConvexError, v } from 'convex/values';
import type { Id } from './_generated/dataModel';
import { mutation, query } from './_generated/server';
import {
	getMembershipByProfileId,
	getProfileAuthUserId,
	getRelatedProfile,
	requireIdentity,
	requireProfile
} from './permissions';

const sortProfiles = (profileIds: Array<Id<'profiles'>>) => [...new Set(profileIds)].sort();

const listParticipantRows = async (
	ctx: Parameters<typeof requireProfile>[0],
	profileId: Id<'profiles'>
) => {
	return await ctx.db
		.query('participants')
		.withIndex('by_profile', (q) => q.eq('profileId', profileId))
		.collect();
};

const getRoomParticipant = async (
	ctx: Parameters<typeof requireProfile>[0],
	roomId: Id<'rooms'>,
	profileId: Id<'profiles'>
) => {
	return await ctx.db
		.query('participants')
		.withIndex('by_room_and_profile', (q) => q.eq('roomId', roomId).eq('profileId', profileId))
		.unique();
};

export const listRooms = query({
	args: {},
	handler: async (ctx) => {
		const identity = await requireIdentity(ctx);
		const profile = await requireProfile(ctx, identity.subject);
		const memberships = await listParticipantRows(ctx, profile._id);

		const rooms = await Promise.all(memberships.map((membership) => ctx.db.get(membership.roomId)));
		return rooms.filter((room): room is NonNullable<typeof room> => Boolean(room));
	}
});

export const listRoomSummaries = query({
	args: {},
	handler: async (ctx) => {
		const identity = await requireIdentity(ctx);
		const profile = await requireProfile(ctx, identity.subject);
		const memberships = await listParticipantRows(ctx, profile._id);
		const membershipByRoomId = new Map(
			memberships.map((membership) => [membership.roomId, membership])
		);

		const rooms = await Promise.all(memberships.map((membership) => ctx.db.get(membership.roomId)));
		const summaries = [] as Array<{
			roomId: Id<'rooms'>;
			roomName: string;
			isGroupChat: boolean;
			participantUserIds: string[];
			participantDisplayNames: string[];
			lastMessagePreview: string | null;
			lastMessageAt: number;
			unreadCount: number;
		}>;

		for (const room of rooms) {
			if (!room) {
				continue;
			}

			const participants = await ctx.db
				.query('participants')
				.withIndex('by_room', (q) => q.eq('roomId', room._id))
				.collect();
			const otherParticipants = (
				await Promise.all(
					participants.map(async (participant) => ({
						participant,
						profile: await getRelatedProfile(ctx, participant.profileId)
					}))
				)
			).filter((entry): entry is typeof entry & { profile: NonNullable<typeof entry.profile> } =>
				Boolean(entry.profile && entry.profile._id !== profile._id)
			);
			const otherUserIds = otherParticipants
				.map(({ profile: participantProfile }) => getProfileAuthUserId(participantProfile))
				.filter((userId): userId is string => Boolean(userId));

			const participantDisplayNames = [] as string[];
			for (const { participant, profile: participantProfile } of otherParticipants) {
				participantDisplayNames.push(
					participant?.displayName ?? participantProfile.username ?? 'Member'
				);
			}

			const lastMessagePreview = room.lastMessagePreview ?? null;
			const lastMessageAt = room.lastMessageAt ?? room.createdAt;
			const unreadCount = Math.max(membershipByRoomId.get(room._id)?.unreadCount ?? 0, 0);

			summaries.push({
				roomId: room._id,
				roomName:
					room.name ??
					(participantDisplayNames.length
						? participantDisplayNames.join(', ')
						: room.isGroupChat
							? 'Group chat'
							: 'Direct chat'),
				isGroupChat: room.isGroupChat,
				participantUserIds: otherUserIds,
				participantDisplayNames,
				lastMessagePreview,
				lastMessageAt,
				unreadCount
			});
		}

		return summaries.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
	}
});

export const getUnreadSummary = query({
	args: {},
	handler: async (ctx) => {
		const identity = await requireIdentity(ctx);
		const profile = await requireProfile(ctx, identity.subject);
		const memberships = await listParticipantRows(ctx, profile._id);

		let totalUnreadCount = 0;
		let roomsWithUnreadCount = 0;
		for (const membership of memberships) {
			const unreadCount = Math.max(membership.unreadCount ?? 0, 0);
			totalUnreadCount += unreadCount;
			if (unreadCount > 0) roomsWithUnreadCount += 1;
		}

		return {
			totalUnreadCount,
			roomsWithUnreadCount
		};
	}
});

export const getOrCreateDirectRoom = mutation({
	args: {
		otherProfileId: v.id('profiles')
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const viewerProfile = await requireProfile(ctx, identity.subject);
		if (viewerProfile._id === args.otherProfileId) {
			throw new ConvexError('Cannot create a direct room with yourself');
		}
		const otherProfile = await ctx.db.get(args.otherProfileId);
		if (!otherProfile) {
			throw new ConvexError('Profile not found');
		}
		if (!viewerProfile.activeClubId) {
			throw new ConvexError('An active club is required to start a new chat');
		}
		const activeClubId = viewerProfile.activeClubId;
		const sharedMembership = await getMembershipByProfileId(ctx, activeClubId, args.otherProfileId);
		if (!sharedMembership) {
			throw new ConvexError('You can only start chats with members of your active club');
		}

		const [directProfileAId, directProfileBId] = sortProfiles([
			viewerProfile._id,
			args.otherProfileId
		]);

		const existing = await ctx.db
			.query('rooms')
			.withIndex('by_direct_profiles', (q) =>
				q.eq('directProfileAId', directProfileAId).eq('directProfileBId', directProfileBId)
			)
			.unique();
		if (existing && !existing.isGroupChat) {
			return existing;
		}

		const now = Date.now();
		const roomId = await ctx.db.insert('rooms', {
			isGroupChat: false,
			directProfileAId,
			directProfileBId,
			createdAt: now
		});

		await ctx.db.insert('participants', {
			roomId,
			profileId: viewerProfile._id,
			isAdmin: true,
			displayName:
				viewerProfile.username ||
				[viewerProfile.firstName, viewerProfile.lastName].filter(Boolean).join(' ').trim() ||
				identity.subject,
			coverPhotoUrl: viewerProfile.coverPhotoUrl,
			lastReadAt: now,
			unreadCount: 0,
			createdAt: now
		});
		await ctx.db.insert('participants', {
			roomId,
			profileId: otherProfile._id,
			isAdmin: false,
			displayName:
				otherProfile.username ||
				[otherProfile.firstName, otherProfile.lastName].filter(Boolean).join(' ').trim() ||
				getProfileAuthUserId(otherProfile) ||
				'Member',
			coverPhotoUrl: otherProfile.coverPhotoUrl,
			lastReadAt: now,
			unreadCount: 0,
			createdAt: now
		});

		return await ctx.db.get(roomId);
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
		const membership = await getRoomParticipant(ctx, args.roomId, profile._id);
		if (!membership) {
			throw new ConvexError('Not a participant in this room');
		}

		const records = await ctx.db
			.query('messages')
			.withIndex('by_room_and_created', (q) => q.eq('roomId', args.roomId))
			.order('desc')
			.take(args.limit ?? 50);
		const resolved = await Promise.all(
			records.map(async (message) => {
				const author = await getRelatedProfile(ctx, message.profileId);
				return {
					...message,
					profileId: author?._id ?? message.profileId,
					userId: author ? getProfileAuthUserId(author) : 'unknown'
				};
			})
		);
		return resolved.reverse();
	}
});

export const sendMessage = mutation({
	args: {
		roomId: v.id('rooms'),
		content: v.optional(v.string()),
		mediaUrl: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const profile = await requireProfile(ctx, identity.subject);
		const membership = await getRoomParticipant(ctx, args.roomId, profile._id);
		if (!membership) {
			throw new ConvexError('Not a participant in this room');
		}

		if (!args.content && !args.mediaUrl) {
			throw new ConvexError('Message content is required');
		}

		const now = Date.now();
		const messageId = await ctx.db.insert('messages', {
			roomId: args.roomId,
			profileId: profile._id,
			content: args.content,
			type: args.mediaUrl ? 'media' : 'text',
			mediaUrl: args.mediaUrl,
			isDeleted: false,
			createdAt: now
		});

		const preview = args.content?.trim()
			? args.content.trim().slice(0, 140)
			: args.mediaUrl
				? 'Media message'
				: null;
		await ctx.db.patch(args.roomId, {
			lastMessageAt: now,
			lastMessagePreview: preview ?? undefined
		});
		const participants = await ctx.db
			.query('participants')
			.withIndex('by_room', (q) => q.eq('roomId', args.roomId))
			.collect();
		await Promise.all(
			participants.map((participant) =>
				ctx.db.patch(
					participant._id,
					participant.profileId === profile._id
						? {
								lastReadAt: now,
								unreadCount: 0
							}
						: {
								unreadCount: (participant.unreadCount ?? 0) + 1
							}
				)
			)
		);

		return await ctx.db.get(messageId);
	}
});

export const markRoomRead = mutation({
	args: {
		roomId: v.id('rooms')
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const profile = await requireProfile(ctx, identity.subject);
		const membership = await getRoomParticipant(ctx, args.roomId, profile._id);
		if (!membership) {
			throw new ConvexError('Not a participant in this room');
		}

		const now = Date.now();
		await ctx.db.patch(membership._id, {
			lastReadAt: now,
			unreadCount: 0
		});
		return {
			roomId: args.roomId,
			unreadCount: 0
		};
	}
});

export const listUsersForMessaging = query({
	args: {},
	handler: async (ctx) => {
		const identity = await requireIdentity(ctx);
		const userIdSet = new Set<string>();
		const users: Array<{
			profileId: Id<'profiles'>;
			userId: string;
			displayName: string;
		}> = [];

		// Get viewer's active club from profile
		const viewerProfile = await requireProfile(ctx, identity.subject);

		if (!viewerProfile?.activeClubId) {
			return [];
		}

		const clubId = viewerProfile.activeClubId;

		// Get all active club members (all members regardless of role)
		const clubMembers = await ctx.db
			.query('clubMembers')
			.withIndex('by_club', (q) => q.eq('clubId', clubId))
			.collect();

		// Add club members
		for (const member of clubMembers) {
			if (member.leftAt) continue; // Skip members who left
			const memberProfile = await getRelatedProfile(ctx, member.profileId);
			if (!memberProfile || memberProfile._id === viewerProfile._id) continue;
			const memberAuthUserId = getProfileAuthUserId(memberProfile);
			if (!memberAuthUserId) continue;

			if (!userIdSet.has(memberAuthUserId)) {
				userIdSet.add(memberAuthUserId);

				const displayName =
					memberProfile?.username ||
					[memberProfile?.firstName, memberProfile?.lastName].filter(Boolean).join(' ').trim() ||
					memberAuthUserId;

				users.push({
					profileId: memberProfile._id,
					userId: memberAuthUserId,
					displayName
				});
			}
		}

		// Get all projects in the club via projectClubs table
		const projectLinks = await ctx.db
			.query('projectClubs')
			.withIndex('by_club', (q) => q.eq('clubId', clubId))
			.collect();

		// Get all project members
		for (const link of projectLinks) {
			const project = await ctx.db.get(link.projectId);
			if (!project) continue;

			const projectMembers = await ctx.db
				.query('projectMembers')
				.withIndex('by_project', (q) => q.eq('projectId', project._id))
				.collect();

			for (const projectMember of projectMembers) {
				if (projectMember.leftAt) continue; // Skip members who left
				const memberProfile = await getRelatedProfile(ctx, projectMember.profileId);
				if (!memberProfile || memberProfile._id === viewerProfile._id) continue;
				const memberAuthUserId = getProfileAuthUserId(memberProfile);
				if (!memberAuthUserId) continue;

				if (!userIdSet.has(memberAuthUserId)) {
					userIdSet.add(memberAuthUserId);

					const displayName =
						memberProfile?.username ||
						[memberProfile?.firstName, memberProfile?.lastName].filter(Boolean).join(' ').trim() ||
						memberAuthUserId;

					users.push({
						profileId: memberProfile._id,
						userId: memberAuthUserId,
						displayName
					});
				}
			}
		}

		// Sort by display name
		users.sort((a, b) => a.displayName.localeCompare(b.displayName));
		return users;
	}
});
