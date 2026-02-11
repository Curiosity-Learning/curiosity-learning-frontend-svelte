import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { requireIdentity, requireProfile } from './permissions';

export const getMe = query({
	args: {},
	handler: async (ctx) => {
		const identity = await requireIdentity(ctx);
		return requireProfile(ctx, identity.subject);
	}
});

export const updateMe = mutation({
	args: {
		firstName: v.optional(v.string()),
		lastName: v.optional(v.string()),
		username: v.optional(v.string()),
		coverPhotoUrl: v.optional(v.string()),
		dateOfBirth: v.optional(v.string()),
		about: v.optional(v.string()),
		howDidYouFindUs: v.optional(v.string()),
		identity: v.optional(v.string()),
		locationAddress: v.optional(v.string()),
		videoUrl: v.optional(v.string()),
		pendingClubCode: v.optional(v.string()),
		pendingRole: v.optional(v.union(v.literal('Learner'), v.literal('Guide'))),
		firstLoginCompleted: v.optional(v.boolean()),
		fcmToken: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const profile = await requireProfile(ctx, identity.subject);

		if (args.username && args.username !== profile.username) {
			const existing = await ctx.db
				.query('profiles')
				.withIndex('by_username', (q) => q.eq('username', args.username))
				.first();
			if (existing && existing._id !== profile._id) {
				throw new ConvexError('Username is already taken');
			}
		}

		await ctx.db.patch(profile._id, {
			...args,
			updatedAt: Date.now()
		});

		const updated = await ctx.db.get(profile._id);
		if (!updated) {
			throw new ConvexError('Profile not found');
		}

		const displayName =
			updated.username ||
			[updated.firstName, updated.lastName].filter(Boolean).join(' ').trim() ||
			updated.email ||
			identity.subject;

		// Keep denormalized member/profile fields in sync for faster reads.
		const clubMemberships = await ctx.db
			.query('clubMembers')
			.withIndex('by_user', (q) => q.eq('userId', identity.subject))
			.collect();
		for (const membership of clubMemberships) {
			if (membership.leftAt) continue;
			await ctx.db.patch(membership._id, {
				firstName: updated.firstName,
				lastName: updated.lastName,
				username: updated.username,
				email: updated.email,
				coverPhotoUrl: updated.coverPhotoUrl
			});
		}

		const projectMemberships = await ctx.db
			.query('projectMembers')
			.withIndex('by_user', (q) => q.eq('userId', identity.subject))
			.collect();
		for (const membership of projectMemberships) {
			if (membership.leftAt) continue;
			await ctx.db.patch(membership._id, {
				firstName: updated.firstName,
				lastName: updated.lastName,
				username: updated.username,
				email: updated.email,
				coverPhotoUrl: updated.coverPhotoUrl
			});
		}

		const participantRows = await ctx.db
			.query('participants')
			.withIndex('by_user', (q) => q.eq('userId', identity.subject))
			.collect();
		for (const participant of participantRows) {
			await ctx.db.patch(participant._id, {
				displayName,
				coverPhotoUrl: updated.coverPhotoUrl
			});
		}

		return updated;
	}
});

export const checkUsernameAvailability = query({
	args: {
		username: v.string()
	},
	handler: async (ctx, args) => {
		const normalized = args.username.trim().toLowerCase();
		if (!normalized) {
			return false;
		}
		const existing = await ctx.db
			.query('profiles')
			.withIndex('by_username', (q) => q.eq('username', normalized))
			.first();
		return !existing;
	}
});
