import { ConvexError, v } from 'convex/values';
import type { Id } from './_generated/dataModel';
import { mutation, query } from './_generated/server';
import { requireIdentity, requireProfile } from './permissions';

const sortUsers = (userIds: string[]) => [...new Set(userIds)].sort();
const directKeyFor = (userA: string, userB: string) => sortUsers([userA, userB]).join('|');

export const listRooms = query({
	args: {},
	handler: async (ctx) => {
		const identity = await requireIdentity(ctx);
		const memberships = await ctx.db
			.query('participants')
			.withIndex('by_user', (q) => q.eq('userId', identity.subject))
			.collect();

		const rooms = await Promise.all(memberships.map((membership) => ctx.db.get(membership.roomId)));
		return rooms.filter((room): room is NonNullable<typeof room> => Boolean(room));
	}
});

export const listRoomSummaries = query({
	args: {},
	handler: async (ctx) => {
		const identity = await requireIdentity(ctx);
		const memberships = await ctx.db
			.query('participants')
			.withIndex('by_user', (q) => q.eq('userId', identity.subject))
			.collect();
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
			const otherUserIds = participants
				.map((participant) => participant.userId)
				.filter((userId) => userId !== identity.subject);

			const participantDisplayNames = [] as string[];
			for (const userId of otherUserIds) {
				const participant = participants.find((p) => p.userId === userId);
				participantDisplayNames.push(participant?.displayName ?? userId);
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
		const memberships = await ctx.db
			.query('participants')
			.withIndex('by_user', (q) => q.eq('userId', identity.subject))
			.collect();

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
		otherUserId: v.string()
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		if (identity.subject === args.otherUserId) {
			throw new ConvexError('Cannot create a direct room with yourself');
		}
		const viewerProfile = await requireProfile(ctx, identity.subject);
		if (!viewerProfile.activeClubId) {
			throw new ConvexError('An active club is required to start a new chat');
		}
		const activeClubId = viewerProfile.activeClubId;
		const sharedMembership = await ctx.db
			.query('clubMembers')
			.withIndex('by_club_and_user', (q) =>
				q.eq('clubId', activeClubId).eq('userId', args.otherUserId)
			)
			.first();
		if (!sharedMembership || sharedMembership.leftAt) {
			throw new ConvexError('You can only start chats with members of your active club');
		}

		const directKey = directKeyFor(identity.subject, args.otherUserId);

		const existing = await ctx.db
			.query('rooms')
			.withIndex('by_direct_key', (q) => q.eq('directKey', directKey))
			.first();
		if (existing && !existing.isGroupChat) {
			return existing;
		}

		const now = Date.now();
		const roomId = await ctx.db.insert('rooms', {
			isGroupChat: false,
			directKey,
			createdAt: now
		});

		const otherProfile = await requireProfile(ctx, args.otherUserId);

		await ctx.db.insert('participants', {
			roomId,
			userId: identity.subject,
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
			userId: args.otherUserId,
			isAdmin: false,
			displayName:
				otherProfile.username ||
				[otherProfile.firstName, otherProfile.lastName].filter(Boolean).join(' ').trim() ||
				args.otherUserId,
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
		const membership = await ctx.db
			.query('participants')
			.withIndex('by_room_and_user', (q) =>
				q.eq('roomId', args.roomId).eq('userId', identity.subject)
			)
			.first();
		if (!membership) {
			throw new ConvexError('Not a participant in this room');
		}

		const records = await ctx.db
			.query('messages')
			.withIndex('by_room_and_created', (q) => q.eq('roomId', args.roomId))
			.order('desc')
			.take(args.limit ?? 50);
		return records.reverse();
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
		const membership = await ctx.db
			.query('participants')
			.withIndex('by_room_and_user', (q) =>
				q.eq('roomId', args.roomId).eq('userId', identity.subject)
			)
			.first();
		if (!membership) {
			throw new ConvexError('Not a participant in this room');
		}

		if (!args.content && !args.mediaUrl) {
			throw new ConvexError('Message content is required');
		}

		const now = Date.now();
		const messageId = await ctx.db.insert('messages', {
			roomId: args.roomId,
			userId: identity.subject,
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
					participant.userId === identity.subject
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
		const membership = await ctx.db
			.query('participants')
			.withIndex('by_room_and_user', (q) =>
				q.eq('roomId', args.roomId).eq('userId', identity.subject)
			)
			.first();
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
			userId: string;
			displayName: string;
		}> = [];

		// Get viewer's active club from profile
		const viewerProfile = await ctx.db
			.query('profiles')
			.withIndex('by_user_id', (q) => q.eq('userId', identity.subject))
			.first();

		console.log('[chat] Viewer profile:', {
			userId: identity.subject,
			activeClubId: viewerProfile?.activeClubId
		});

		if (!viewerProfile?.activeClubId) {
			console.log('[chat] No active club found');
			return [];
		}

		const clubId = viewerProfile.activeClubId;

		// Get all active club members (all members regardless of role)
		const clubMembers = await ctx.db
			.query('clubMembers')
			.withIndex('by_club', (q) => q.eq('clubId', clubId))
			.collect();

		console.log('[chat] Club members found:', clubMembers.length);

		// Add club members
		for (const member of clubMembers) {
			if (member.leftAt) continue; // Skip members who left
			if (member.userId === identity.subject) continue; // Skip self

			if (!userIdSet.has(member.userId)) {
				userIdSet.add(member.userId);

				const memberProfile = await ctx.db
					.query('profiles')
					.withIndex('by_user_id', (q) => q.eq('userId', member.userId))
					.first();

				const displayName =
					memberProfile?.username ||
					[memberProfile?.firstName, memberProfile?.lastName].filter(Boolean).join(' ').trim() ||
					member.userId;

				users.push({
					userId: member.userId,
					displayName
				});
			}
		}

		console.log('[chat] Users after club members:', users.length);

		// Get all projects in the club via projectClubs table
		const projectLinks = await ctx.db
			.query('projectClubs')
			.withIndex('by_club', (q) => q.eq('clubId', clubId))
			.collect();

		console.log('[chat] Project links found:', projectLinks.length);

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
				if (projectMember.userId === identity.subject) continue; // Skip self

				if (!userIdSet.has(projectMember.userId)) {
					userIdSet.add(projectMember.userId);

					const memberProfile = await ctx.db
						.query('profiles')
						.withIndex('by_user_id', (q) => q.eq('userId', projectMember.userId))
						.first();

					const displayName =
						memberProfile?.username ||
						[memberProfile?.firstName, memberProfile?.lastName].filter(Boolean).join(' ').trim() ||
						projectMember.userId;

					users.push({
						userId: projectMember.userId,
						displayName
					});
				}
			}
		}

		console.log('[chat] Final users list:', users.length, users);

		// Sort by display name
		users.sort((a, b) => a.displayName.localeCompare(b.displayName));
		return users;
	}
});
