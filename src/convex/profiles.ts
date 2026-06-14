import { ConvexError, v } from 'convex/values';
import type { Id } from './_generated/dataModel';
import { components } from './_generated/api';
import { mutation, query, type MutationCtx, type QueryCtx } from './_generated/server';
import { resolveMediaAssetFileUrl } from './mediaStorage';
import { listMembershipsForProfile, requireIdentity, requireProfile } from './permissions';
import { getUsernameValidationError } from './usernameValidator';

type Ctx = QueryCtx | MutationCtx;

const resolveProfileImageUrl = async (
	ctx: Ctx,
	profile: {
		profileImageMediaAssetId?: Id<'mediaAssets'>;
	}
) => {
	if (!profile.profileImageMediaAssetId) {
		return null;
	}

	const asset = await ctx.db.get(profile.profileImageMediaAssetId);
	if (!asset || asset.status !== 'ready' || asset.mediaKind === 'video') {
		return null;
	}

	return resolveMediaAssetFileUrl(asset) ?? null;
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
			const validationError = getUsernameValidationError(args.username);
			if (validationError) {
				throw new ConvexError(validationError);
			}
			const existing = await ctx.db
				.query('profiles')
				.withIndex('by_username', (q) => q.eq('username', args.username))
				.first();
			if (existing && existing._id !== profile._id) {
				throw new ConvexError('Username is already taken');
			}

			const authUserWithUsername = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
				model: 'user',
				where: [{ field: 'username', value: args.username }]
			})) as { _id: string } | null;
			if (authUserWithUsername && authUserWithUsername._id !== identity.subject) {
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

		if (args.username && args.username !== profile.username) {
			await ctx.runMutation(components.betterAuth.adapter.updateOne, {
				input: {
					model: 'user',
					where: [{ field: '_id', value: identity.subject }],
					update: {
						username: args.username,
						displayUsername: args.username,
						updatedAt: Date.now()
					}
				}
			});
		}

		const updated = await ctx.db.get(profile._id);
		if (!updated) {
			throw new ConvexError('Profile not found');
		}

		const resolvedCoverPhotoUrl = await resolveProfileImageUrl(ctx, updated);
		const denormalizedCoverPhotoUrl = resolvedCoverPhotoUrl ?? undefined;

		const displayName =
			updated.username ||
			[updated.firstName, updated.lastName].filter(Boolean).join(' ').trim() ||
			identity.subject;

		// Keep denormalized member/profile fields in sync for faster reads.
		const clubMemberships = await listMembershipsForProfile(ctx, updated);
		for (const membership of clubMemberships) {
			if (membership.leftAt) continue;
			await ctx.db.patch(membership._id, {
				profileId: updated._id,
				userId: undefined,
				firstName: updated.firstName,
				lastName: updated.lastName,
				username: updated.username,
				coverPhotoUrl: denormalizedCoverPhotoUrl
			});
		}

		const projectMembershipsByProfile = await ctx.db
			.query('projectMembers')
			.withIndex('by_profile', (q) => q.eq('profileId', updated._id))
			.collect();
		const legacyProjectMemberships = await ctx.db
			.query('projectMembers')
			.withIndex('by_user', (q) => q.eq('userId', identity.subject))
			.collect();
		const projectMemberships = [
			...new Map(
				[...projectMembershipsByProfile, ...legacyProjectMemberships].map((row) => [row._id, row])
			).values()
		];
		for (const membership of projectMemberships) {
			if (membership.leftAt) continue;
			await ctx.db.patch(membership._id, {
				profileId: updated._id,
				userId: undefined,
				firstName: updated.firstName,
				lastName: updated.lastName,
				username: updated.username,
				coverPhotoUrl: denormalizedCoverPhotoUrl
			});
		}

		const participantsByProfile = await ctx.db
			.query('participants')
			.withIndex('by_profile', (q) => q.eq('profileId', updated._id))
			.collect();
		const legacyParticipants = await ctx.db
			.query('participants')
			.withIndex('by_user', (q) => q.eq('userId', identity.subject))
			.collect();
		const participantRows = [
			...new Map(
				[...participantsByProfile, ...legacyParticipants].map((row) => [row._id, row])
			).values()
		];
		for (const participant of participantRows) {
			await ctx.db.patch(participant._id, {
				profileId: updated._id,
				userId: undefined,
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
		const validationError = getUsernameValidationError(normalized);
		if (validationError) {
			return false;
		}
		const existing = await ctx.db
			.query('profiles')
			.withIndex('by_username', (q) => q.eq('username', normalized))
			.first();
		if (existing) {
			return false;
		}

		const authUserWithUsername = await ctx.runQuery(components.betterAuth.adapter.findOne, {
			model: 'user',
			where: [{ field: 'username', value: normalized }]
		});
		return !authUserWithUsername;
	}
});
