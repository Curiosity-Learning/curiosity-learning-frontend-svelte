import { v } from 'convex/values';
import { internal } from './_generated/api';
import {
	internalAction,
	internalMutation,
	internalQuery,
	mutation,
	query
} from './_generated/server';
import { getAuthUserEmail } from './authEmail';
import { CHILD_EMAIL_DOMAIN } from './childAccounts';
import { sendEmail } from './email/resend';
import { notificationEmail } from './email/templates';
import { requireIdentity, requireProfile } from './permissions';

export const list = query({
	args: {},
	handler: async (ctx) => {
		const identity = await requireIdentity(ctx);
		const profile = await requireProfile(ctx, identity.subject);
		return await ctx.db
			.query('notifications')
			.withIndex('by_profile_and_created', (q) => q.eq('profileId', profile._id))
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
		const profile = await requireProfile(ctx, identity.subject);
		const notification = await ctx.db.get(args.notificationId);
		if (!notification || notification.profileId !== profile._id) {
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
		const notifications = await ctx.db
			.query('notifications')
			.withIndex('by_profile_and_created', (q) => q.eq('profileId', profile._id))
			.order('desc')
			.take(100);

		for (const notification of notifications) {
			if (notification.isRead) continue;
			await ctx.db.patch(notification._id, { isRead: true });
		}

		return { success: true };
	}
});

export const unreadCount = query({
	args: {},
	handler: async (ctx) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return 0;
		const profile = await ctx.db
			.query('profiles')
			.withIndex('by_auth_user_id', (q) => q.eq('authUserId', identity.subject))
			.unique();
		if (!profile) return 0;
		// Bounded like `list`/`markAllRead`: the UI shows at most 100 notifications.
		const notifications = await ctx.db
			.query('notifications')
			.withIndex('by_profile_and_created', (q) => q.eq('profileId', profile._id))
			.order('desc')
			.take(100);
		return notifications.filter((notification) => !notification.isRead).length;
	}
});

// Resolves the deliverable email address for a notification recipient.
// - Adult accounts: their Better Auth email.
// - Child accounts (synthetic @children.curiosity.local auth email): the approved parent
//   email from parentChildConsents for CRITICAL notices, otherwise null (no email).
export const resolveNotificationEmailRecipient = internalQuery({
	args: {
		recipientProfileId: v.id('profiles'),
		critical: v.boolean()
	},
	returns: v.union(v.string(), v.null()),
	handler: async (ctx, args) => {
		const profile = await ctx.db.get(args.recipientProfileId);
		if (!profile) return null;

		const email = await getAuthUserEmail(ctx, profile.authUserId);
		if (!email) return null;

		if (!email.toLowerCase().endsWith(`@${CHILD_EMAIL_DOMAIN}`)) {
			return email;
		}

		// Child account: never email the synthetic address.
		if (!args.critical) return null;
		const consent = await ctx.db
			.query('parentChildConsents')
			.withIndex('by_child_profile_id', (q) => q.eq('childProfileId', args.recipientProfileId))
			.order('desc')
			.collect();
		const approved = consent.find((row) => row.status === 'approved');
		return approved?.parentEmail ?? null;
	}
});

// Sends the email channel of a dispatched notification (scheduled by dispatchNotification
// in notificationsModel.ts for critical/high tiers). Failures are already reported to
// monitoring inside sendEmail; they are swallowed here so a delivery hiccup never surfaces
// as a scheduler error loop.
export const sendNotificationEmail = internalAction({
	args: {
		recipientProfileId: v.id('profiles'),
		critical: v.boolean(),
		title: v.string(),
		message: v.string(),
		url: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const to = await ctx.runQuery(internal.notifications.resolveNotificationEmailRecipient, {
			recipientProfileId: args.recipientProfileId,
			critical: args.critical
		});
		if (!to) return;

		const baseUrl = process.env.BETTER_AUTH_URL ?? process.env.PUBLIC_CONVEX_SITE_URL;
		const ctaUrl = args.url
			? args.url.startsWith('/')
				? baseUrl
					? `${baseUrl.replace(/\/+$/, '')}${args.url}`
					: undefined
				: args.url
			: baseUrl;

		try {
			await sendEmail({
				to,
				type: 'notification',
				...notificationEmail({ title: args.title, message: args.message, ctaUrl })
			});
		} catch {
			// Already reported inside sendEmail.
		}
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
