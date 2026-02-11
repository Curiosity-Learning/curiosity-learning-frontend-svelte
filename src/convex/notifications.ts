import { v } from 'convex/values';
import { internalMutation, mutation, query } from './_generated/server';
import { requireIdentity } from './permissions';

export const list = query({
	args: {},
	handler: async (ctx) => {
		const identity = await requireIdentity(ctx);
		return await ctx.db
			.query('notifications')
			.withIndex('by_user_and_created', (q) => q.eq('userId', identity.subject))
			.order('desc')
			.take(100);
	}
});

export const markRead = mutation({
	args: {
		notificationId: v.id('notifications')
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const notification = await ctx.db.get(args.notificationId);
		if (!notification || notification.userId !== identity.subject) {
			return { success: false };
		}

		await ctx.db.patch(args.notificationId, {
			isRead: true
		});

		return { success: true };
	}
});

export const markAllRead = mutation({
	args: {},
	handler: async (ctx) => {
		const identity = await requireIdentity(ctx);
		// Bound the work; the UI currently shows at most 100 notifications.
		const notifications = await ctx.db
			.query('notifications')
			.withIndex('by_user_and_created', (q) => q.eq('userId', identity.subject))
			.order('desc')
			.take(100);

		for (const notification of notifications) {
			if (notification.isRead) continue;
			await ctx.db.patch(notification._id, { isRead: true });
		}

		return { success: true };
	}
});

export const createSystemNotification = internalMutation({
	args: {
		userId: v.string(),
		title: v.string(),
		message: v.string(),
		url: v.optional(v.string()),
		clubId: v.optional(v.id('clubs'))
	},
	handler: async (ctx, args) => {
		return await ctx.db.insert('notifications', {
			userId: args.userId,
			title: args.title,
			message: args.message,
			url: args.url,
			clubId: args.clubId,
			isRead: false,
			createdAt: Date.now()
		});
	}
});
