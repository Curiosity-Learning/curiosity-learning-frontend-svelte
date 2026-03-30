import { ConvexError, v } from 'convex/values';
import type { Id } from './_generated/dataModel';
import { mutation, query, type MutationCtx, type QueryCtx } from './_generated/server';
import { resolveMediaAssetFileUrl } from './mediaStorage';
import { requireIdentity, requireProfile } from './permissions';

type Ctx = QueryCtx | MutationCtx;

const resolveProfileImageUrl = async (
	ctx: Ctx,
	profile: {
		coverPhotoUrl?: string;
		profileImageMediaAssetId?: Id<'mediaAssets'>;
	}
) => {
	if (!profile.profileImageMediaAssetId) {
		return profile.coverPhotoUrl ?? null;
	}

	const asset = await ctx.db.get(profile.profileImageMediaAssetId);
	if (!asset || asset.status !== 'ready' || asset.mediaKind === 'video') {
		return profile.coverPhotoUrl ?? null;
	}

	return resolveMediaAssetFileUrl(asset) ?? profile.coverPhotoUrl ?? null;
};

const requireOwnedReadyProfileImage = async (
	ctx: MutationCtx,
	userId: string,
	assetId: Id<'mediaAssets'>
) => {
	const asset = await ctx.db.get(assetId);
	if (!asset || asset.ownerUserId !== userId) {
		throw new ConvexError('Profile image not found');
	}
	if (asset.status !== 'ready') {
		throw new ConvexError('Profile image is not ready');
	}
	if (asset.mediaKind === 'video') {
		throw new ConvexError('Profile image must be an image');
	}

	return asset;
};

export const getMe = query({
	args: {},
	handler: async (ctx) => {
		const identity = await requireIdentity(ctx);
		const profile = await requireProfile(ctx, identity.subject);
		return {
			...profile,
			coverPhotoUrl: await resolveProfileImageUrl(ctx, profile)
		};
	}
});

export const updateMe = mutation({
	args: {
		firstName: v.optional(v.string()),
		lastName: v.optional(v.string()),
		username: v.optional(v.string()),
		coverPhotoUrl: v.optional(v.string()),
		profileImageMediaAssetId: v.optional(v.id('mediaAssets')),
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

		let nextCoverPhotoUrl = args.coverPhotoUrl ?? profile.coverPhotoUrl;
		if (args.profileImageMediaAssetId) {
			const asset = await requireOwnedReadyProfileImage(
				ctx,
				identity.subject,
				args.profileImageMediaAssetId
			);
			nextCoverPhotoUrl = resolveMediaAssetFileUrl(asset) ?? undefined;
		}

		await ctx.db.patch(profile._id, {
			...args,
			coverPhotoUrl: nextCoverPhotoUrl,
			updatedAt: Date.now()
		});

		const updated = await ctx.db.get(profile._id);
		if (!updated) {
			throw new ConvexError('Profile not found');
		}

		const resolvedCoverPhotoUrl = await resolveProfileImageUrl(ctx, updated);
		const denormalizedCoverPhotoUrl = resolvedCoverPhotoUrl ?? undefined;

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
				coverPhotoUrl: denormalizedCoverPhotoUrl
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
				coverPhotoUrl: denormalizedCoverPhotoUrl
			});
		}

		const participantRows = await ctx.db
			.query('participants')
			.withIndex('by_user', (q) => q.eq('userId', identity.subject))
			.collect();
		for (const participant of participantRows) {
			await ctx.db.patch(participant._id, {
				displayName,
				coverPhotoUrl: denormalizedCoverPhotoUrl
			});
		}

		return {
			...updated,
			coverPhotoUrl: resolvedCoverPhotoUrl ?? undefined
		};
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
