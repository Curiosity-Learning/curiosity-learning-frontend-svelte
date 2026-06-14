import { v } from 'convex/values';
import { internalMutation, mutation, query } from './_generated/server';
import { requireIdentity, requireProfile } from './permissions';

export const list = query({
	args: {},
	handler: async (ctx) => {
		const identity = await requireIdentity(ctx);
		const profile = await requireProfile(ctx, identity.subject);
		const byProfile = await ctx.db
			.query('notifications')
			.withIndex('by_profile_and_created', (q) => q.eq('profileId', profile._id))
			.order('desc')
			.take(100);
		const legacy = await ctx.db
			.query('notifications')
			.withIndex('by_user_and_created', (q) => q.eq('userId', identity.subject))
			.order('desc')
			.take(100);
		return [...new Map([...byProfile, ...legacy].map((row) => [row._id, row])).values()]
			.sort((a, b) => b.createdAt - a.createdAt)
			.slice(0, 100);
	}
});

export const markRead = mutation({
	args: {
		notificationId: v.id('notifications')
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const profile = await requireProfile(ctx, identity.subject);
		const notification = await ctx.db.get(args.notificationId);
		if (
			!notification ||
			(notification.profileId
				? notification.profileId !== profile._id
				: notification.userId !== identity.subject)
		) {
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
		const profile = await requireProfile(ctx, identity.subject);
		// Bound the work; the UI currently shows at most 100 notifications.
		const byProfile = await ctx.db
			.query('notifications')
			.withIndex('by_profile_and_created', (q) => q.eq('profileId', profile._id))
			.order('desc')
			.take(100);
		const legacy = await ctx.db
			.query('notifications')
			.withIndex('by_user_and_created', (q) => q.eq('userId', identity.subject))
			.order('desc')
			.take(100);
		const notifications = [
			...new Map([...byProfile, ...legacy].map((row) => [row._id, row])).values()
		].slice(0, 100);

		for (const notification of notifications) {
			if (notification.isRead) continue;
			await ctx.db.patch(notification._id, { isRead: true });
		}

		return { success: true };
	}
});

export const createSystemNotification = internalMutation({
	args: {
		profileId: v.id('profiles'),
		title: v.string(),
		message: v.string(),
		url: v.optional(v.string()),
		clubId: v.optional(v.id('clubs'))
	},
	handler: async (ctx, args) => {
		return await ctx.db.insert('notifications', {
			profileId: args.profileId,
			title: args.title,
			message: args.message,
			url: args.url,
			clubId: args.clubId,
			isRead: false,
			createdAt: Date.now()
		});
	}
});
