import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server';
import type { Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { requireIdentity, requireProfile } from './permissions';

const sortUsers = (userIds: string[]) => [...new Set(userIds)].sort();
const directKeyFor = (userA: string, userB: string) => sortUsers([userA, userB]).join('|');
type Ctx = QueryCtx | MutationCtx;

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

		const rooms = await Promise.all(memberships.map((membership) => ctx.db.get(membership.roomId)));
		const summaries = [] as Array<{
			roomId: Id<'rooms'>;
			roomName: string;
			isGroupChat: boolean;
			participantUserIds: string[];
			participantDisplayNames: string[];
			lastMessagePreview: string | null;
			lastMessageAt: number;
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
				lastMessageAt
			});
		}

		return summaries.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
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

		const viewerProfile = await requireProfile(ctx, identity.subject);
		const otherProfile = await requireProfile(ctx, args.otherUserId);

		await ctx.db.insert('participants', {
			roomId,
			userId: identity.subject,
			isAdmin: true,
			displayName:
				viewerProfile.username ||
				[viewerProfile.firstName, viewerProfile.lastName].filter(Boolean).join(' ').trim() ||
				viewerProfile.email ||
				identity.subject,
			coverPhotoUrl: viewerProfile.coverPhotoUrl,
			createdAt: now
		});
		await ctx.db.insert('participants', {
			roomId,
			userId: args.otherUserId,
			isAdmin: false,
			displayName:
				otherProfile.username ||
				[otherProfile.firstName, otherProfile.lastName].filter(Boolean).join(' ').trim() ||
				otherProfile.email ||
				args.otherUserId,
			coverPhotoUrl: otherProfile.coverPhotoUrl,
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

		return await ctx.db.get(messageId);
	}
});
