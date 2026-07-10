import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { requireIdentity, requireProfile } from './permissions';

const defaultPreferences = {
	clubMemberChanges: true,
	projectDeadlineReminder: true,
	projectMemberAdded: true,
	projectCompleted: true,
	sessionReminder: true,
	sessionActivityChanges: true,
	updateLikes: true,
	updateComments: true,
	chatMessages: true,
	feedbackReminders: true,
	qualityFlags: true
};

export const get = query({
	args: {},
	handler: async (ctx) => {
		const identity = await requireIdentity(ctx);
		const profile = await requireProfile(ctx, identity.subject);
		const current = await ctx.db
			.query('userPreferences')
			.withIndex('by_profile', (q) => q.eq('profileId', profile._id))
			.unique();
		if (current) {
			return current;
		}

		return {
			profileId: profile._id,
			activeClubId: profile.activeClubId,
			theme: 'system' as const,
			notificationsEnabled: true,
			notificationPreferences: defaultPreferences,
			updatedAt: Date.now()
		};
	}
});

export const upsert = mutation({
	args: {
		theme: v.optional(v.union(v.literal('light'), v.literal('dark'), v.literal('system'))),
		notificationsEnabled: v.optional(v.boolean()),
		notificationPreferences: v.optional(
			v.object({
				clubMemberChanges: v.boolean(),
				projectDeadlineReminder: v.boolean(),
				projectMemberAdded: v.boolean(),
				projectCompleted: v.boolean(),
				sessionReminder: v.boolean(),
				sessionActivityChanges: v.boolean(),
				updateLikes: v.boolean(),
				updateComments: v.boolean(),
				chatMessages: v.boolean(),
				feedbackReminders: v.optional(v.boolean()),
				qualityFlags: v.optional(v.boolean())
			})
		),
		activeClubId: v.optional(v.id('clubs'))
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const profile = await requireProfile(ctx, identity.subject);
		const existing = await ctx.db
			.query('userPreferences')
			.withIndex('by_profile', (q) => q.eq('profileId', profile._id))
			.unique();

		const now = Date.now();
		if (existing) {
			await ctx.db.patch(existing._id, {
				profileId: profile._id,
				theme: args.theme ?? existing.theme,
				notificationsEnabled: args.notificationsEnabled ?? existing.notificationsEnabled,
				notificationPreferences: args.notificationPreferences ?? existing.notificationPreferences,
				activeClubId: args.activeClubId ?? existing.activeClubId,
				updatedAt: now
			});
			return await ctx.db.get(existing._id);
		}

		const id = await ctx.db.insert('userPreferences', {
			profileId: profile._id,
			theme: args.theme ?? 'system',
			notificationsEnabled: args.notificationsEnabled ?? true,
			notificationPreferences: args.notificationPreferences ?? defaultPreferences,
			activeClubId: args.activeClubId,
			updatedAt: now
		});

		return await ctx.db.get(id);
	}
});
