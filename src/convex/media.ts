import { ConvexError, v } from 'convex/values';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import {
	action,
	internalMutation,
	internalQuery,
	mutation,
	query,
	type MutationCtx,
	type QueryCtx
} from './_generated/server';
import { buildMediaObjectKey } from './mediaStorage';
import {
	MEDIA_PIPELINE_VERSION,
	mediaFailureValidator,
	mediaPipelineStepResultValidator,
	mediaUploadConstraintsValidator,
	mediaUploadStatusValidator
} from './mediaModel';
import {
	inferSingleAcceptedMediaKind,
	normalizeUploadConstraints
} from './mediaPipeline';
import { mediaModerationResultValidator } from './mediaModeration';
import { toResolvedAsset } from './mediaShared';
import { requireIdentity } from './permissions';

type ReadCtx = QueryCtx | MutationCtx;

const assertOwner = async (ctx: ReadCtx, assetId: Id<'mediaAssets'>, userId: string) => {
	const asset = await ctx.db.get(assetId);
	if (!asset) {
		throw new ConvexError('Upload not found');
	}

	if (asset.ownerUserId !== userId) {
		throw new ConvexError('Permission denied');
	}

	return asset;
};

export const getOwnedAsset = internalQuery({
	args: {
		assetId: v.id('mediaAssets'),
		userId: v.string()
	},
	handler: async (ctx, args) => {
		return await assertOwner(ctx, args.assetId, args.userId);
	}
});

export const getAssetRecord = internalQuery({
	args: {
		assetId: v.id('mediaAssets')
	},
	handler: async (ctx, args) => {
		return await ctx.db.get(args.assetId);
	}
});

export const getAssetAttachmentUsage = internalQuery({
	args: {
		assetId: v.id('mediaAssets')
	},
	handler: async (ctx, args) => {
		const [profile, club] = await Promise.all([
			ctx.db
				.query('profiles')
				.withIndex('by_profile_image_media_asset', (q) =>
					q.eq('profileImageMediaAssetId', args.assetId)
				)
				.first(),
			ctx.db
				.query('clubs')
				.withIndex('by_video_media_asset', (q) => q.eq('videoMediaAssetId', args.assetId))
				.first()
		]);

		return {
			profileId: profile?._id ?? null,
			clubId: club?._id ?? null
		};
	}
});

export const createUploadDraft = internalMutation({
	args: {
		ownerUserId: v.string(),
		sourceBucket: v.string(),
		objectPrefix: v.string(),
		envPrefix: v.string(),
		constraints: mediaUploadConstraintsValidator,
		originalFilename: v.optional(v.string()),
		clientContentType: v.optional(v.string()),
		clientSizeBytes: v.optional(v.number()),
		clientReportedImageCompression: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		const now = Date.now();
		const constraints = normalizeUploadConstraints(args.constraints);
		const assetId = await ctx.db.insert('mediaAssets', {
			ownerUserId: args.ownerUserId,
			mediaKind: inferSingleAcceptedMediaKind(constraints),
			status: 'pending_upload',
			originalFilename: args.originalFilename,
			clientContentType: args.clientContentType,
			clientSizeBytes: args.clientSizeBytes,
			clientReportedImageCompression: args.clientReportedImageCompression,
			acceptedContentTypes: constraints.acceptedContentTypes,
			maxBytes: constraints.maxBytes,
			enableCompression: constraints.enableCompression,
			enableSafetyScreening: constraints.enableSafetyScreening,
			storageProvider: 's3',
			sourceBucket: args.sourceBucket,
			sourceObjectKey: '',
			sourceObjectRevision: 1,
			pipelineVersion: MEDIA_PIPELINE_VERSION,
			attemptCount: 0,
			stepResults: [],
			createdAt: now,
			updatedAt: now
		});
		const sourceObjectKey = buildMediaObjectKey({
			envPrefix: args.envPrefix,
			objectPrefix: args.objectPrefix,
			ownerUserId: args.ownerUserId,
			assetId,
			revision: 1,
			originalFilename: args.originalFilename
		});
		await ctx.db.patch(assetId, {
			sourceObjectKey
		});

		const asset = await ctx.db.get(assetId);
		if (!asset) {
			throw new ConvexError('Failed to create upload');
		}

		return asset;
	}
});

export const markUploadProcessing = internalMutation({
	args: {
		assetId: v.id('mediaAssets'),
		ownerUserId: v.string()
	},
	handler: async (ctx, args) => {
		const asset = await assertOwner(ctx, args.assetId, args.ownerUserId);

		if (asset.status !== 'pending_upload' || !asset.sourceObjectKey || !asset.sourceBucket) {
			throw new ConvexError('Upload is not ready to be finalized');
		}

		const now = Date.now();
		await ctx.db.patch(asset._id, {
			status: 'processing',
			attemptCount: asset.attemptCount + 1,
			stepResults: [],
			lastFailure: undefined,
			uploadCompletedAt: now,
			failedAt: undefined,
			canceledAt: undefined,
			updatedAt: now
		});

		const updated = await ctx.db.get(asset._id);
		if (!updated) {
			throw new ConvexError('Upload not found');
		}

		return updated;
	}
});

export const markUploadCanceled = internalMutation({
	args: {
		assetId: v.id('mediaAssets'),
		ownerUserId: v.string(),
		deleteStorage: v.boolean()
	},
	handler: async (ctx, args) => {
		const asset = await assertOwner(ctx, args.assetId, args.ownerUserId);

		if (asset.status === 'ready') {
			throw new ConvexError('Ready uploads must be detached by feature-level logic, not canceled');
		}

		const now = Date.now();
		await ctx.db.patch(asset._id, {
			status: 'canceled',
			sourceBucket: args.deleteStorage ? undefined : asset.sourceBucket,
			sourceObjectKey: args.deleteStorage ? undefined : asset.sourceObjectKey,
			processedBucket: args.deleteStorage ? undefined : asset.processedBucket,
			processedObjectKey: args.deleteStorage ? undefined : asset.processedObjectKey,
			mediaKind: args.deleteStorage ? undefined : asset.mediaKind,
			contentType: args.deleteStorage ? undefined : asset.contentType,
			sizeBytes: args.deleteStorage ? undefined : asset.sizeBytes,
			durationSeconds: args.deleteStorage ? undefined : asset.durationSeconds,
			sha256: args.deleteStorage ? undefined : asset.sha256,
			lastFailure: undefined,
			stepResults: [],
			canceledAt: now,
			updatedAt: now
		});

		const updated = await ctx.db.get(asset._id);
		if (!updated) {
			throw new ConvexError('Upload not found');
		}

		return updated;
	}
});

export const deleteUploadRecord = internalMutation({
	args: {
		assetId: v.id('mediaAssets'),
		ownerUserId: v.string()
	},
	handler: async (ctx, args) => {
		const asset = await assertOwner(ctx, args.assetId, args.ownerUserId);
		await ctx.db.delete(asset._id);
		return {
			assetId: asset._id,
			deleted: true as const
		};
	}
});

export const markUploadReady = internalMutation({
	args: {
		assetId: v.id('mediaAssets'),
		mediaKind: v.optional(v.union(v.literal('image'), v.literal('video'))),
		contentType: v.optional(v.string()),
		sizeBytes: v.number(),
		durationSeconds: v.optional(v.number()),
		sha256: v.optional(v.string()),
		moderation: v.optional(mediaModerationResultValidator),
		stepResults: v.array(mediaPipelineStepResultValidator)
	},
	handler: async (ctx, args) => {
		const asset = await ctx.db.get(args.assetId);
		if (!asset) {
			return null;
		}
		if (asset.status !== 'processing') {
			return asset;
		}

		const now = Date.now();
		await ctx.db.patch(asset._id, {
			mediaKind: args.mediaKind ?? asset.mediaKind,
			contentType: args.contentType ?? undefined,
			sizeBytes: args.sizeBytes,
			durationSeconds: args.durationSeconds ?? asset.durationSeconds,
			sha256: args.sha256 ?? undefined,
			moderation: args.moderation ?? asset.moderation,
			status: 'ready',
			stepResults: args.stepResults,
			lastFailure: undefined,
			readyAt: now,
			failedAt: undefined,
			canceledAt: undefined,
			updatedAt: now
		});

		return await ctx.db.get(asset._id);
	}
});

export const markUploadFailed = internalMutation({
	args: {
		assetId: v.id('mediaAssets'),
		mediaKind: v.optional(v.union(v.literal('image'), v.literal('video'))),
		contentType: v.optional(v.string()),
		sizeBytes: v.optional(v.number()),
		durationSeconds: v.optional(v.number()),
		sha256: v.optional(v.string()),
		moderation: v.optional(mediaModerationResultValidator),
		stepResults: v.array(mediaPipelineStepResultValidator),
		failure: mediaFailureValidator
	},
	handler: async (ctx, args) => {
		const asset = await ctx.db.get(args.assetId);
		if (!asset) {
			return null;
		}
		if (asset.status !== 'processing') {
			return asset;
		}

		const now = Date.now();
		await ctx.db.patch(asset._id, {
			mediaKind: args.mediaKind ?? asset.mediaKind,
			contentType: args.contentType ?? asset.contentType,
			sizeBytes: args.sizeBytes ?? asset.sizeBytes,
			durationSeconds: args.durationSeconds ?? asset.durationSeconds,
			sha256: args.sha256 ?? asset.sha256,
			moderation: args.moderation ?? asset.moderation,
			status: 'failed',
			lastFailure: args.failure,
			stepResults: args.stepResults,
			failedAt: now,
			updatedAt: now
		});

		return await ctx.db.get(asset._id);
	}
});

export const beginUpload: ReturnType<typeof action> = action({
	args: {
		constraints: mediaUploadConstraintsValidator,
		originalFilename: v.optional(v.string()),
		clientContentType: v.optional(v.string()),
		clientSizeBytes: v.optional(v.number()),
		clientDurationSeconds: v.optional(v.number()),
		clientReportedImageCompression: v.optional(v.boolean())
	},
	handler: async (ctx, args): Promise<unknown> => {
		const identity = await requireIdentity(ctx);
		return await ctx.runAction(internal.mediaNode.beginUpload, {
			ownerUserId: identity.subject,
			constraints: args.constraints,
			originalFilename: args.originalFilename,
			clientContentType: args.clientContentType,
			clientSizeBytes: args.clientSizeBytes,
			clientDurationSeconds: args.clientDurationSeconds,
			clientReportedImageCompression: args.clientReportedImageCompression
		});
	}
});

export const finalizeUpload: ReturnType<typeof action> = action({
	args: {
		assetId: v.id('mediaAssets')
	},
	handler: async (ctx, args): Promise<unknown> => {
		const identity = await requireIdentity(ctx);
		return await ctx.runAction(internal.mediaNode.finalizeUpload, {
			assetId: args.assetId,
			userId: identity.subject
		});
	}
});

export const retryProcessing = mutation({
	args: {
		assetId: v.id('mediaAssets')
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const asset = await assertOwner(ctx, args.assetId, identity.subject);

		if (asset.status !== 'failed' || !asset.sourceObjectKey || !asset.lastFailure?.retryable) {
			throw new ConvexError('Upload is not eligible for retry');
		}

		await ctx.db.patch(asset._id, {
			status: 'processing',
			stepResults: [],
			lastFailure: undefined,
			attemptCount: asset.attemptCount + 1,
			failedAt: undefined,
			canceledAt: undefined,
			updatedAt: Date.now()
		});
		await ctx.scheduler.runAfter(0, internal.mediaNode.processUpload, {
			assetId: asset._id
		});

		const updated = await ctx.db.get(asset._id);
		if (!updated) {
			throw new ConvexError('Upload not found');
		}

		return toResolvedAsset(updated);
	}
});

export const cancelUpload: ReturnType<typeof action> = action({
	args: {
		assetId: v.id('mediaAssets'),
		deleteStorage: v.optional(v.boolean())
	},
	handler: async (ctx, args): Promise<unknown> => {
		const identity = await requireIdentity(ctx);
		return await ctx.runAction(internal.mediaNode.cancelUpload, {
			assetId: args.assetId,
			userId: identity.subject,
			deleteStorage: args.deleteStorage
		});
	}
});

export const deleteUpload: ReturnType<typeof action> = action({
	args: {
		assetId: v.id('mediaAssets')
	},
	handler: async (ctx, args): Promise<unknown> => {
		const identity = await requireIdentity(ctx);
		return await ctx.runAction(internal.mediaNode.deleteUpload, {
			assetId: args.assetId,
			userId: identity.subject
		});
	}
});

export const getUpload = query({
	args: {
		assetId: v.id('mediaAssets')
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const asset = await assertOwner(ctx, args.assetId, identity.subject);
		return toResolvedAsset(asset);
	}
});

export const getOwnedDeliveryAssets = query({
	args: {
		assetIds: v.array(v.id('mediaAssets'))
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const uniqueAssetIds = [...new Set(args.assetIds)];
		const assets = await Promise.all(
			uniqueAssetIds.map(async (assetId) => {
				const asset = await ctx.db.get(assetId);
				if (!asset || asset.ownerUserId !== identity.subject || asset.status !== 'ready') {
					return null;
				}

				return {
					assetId: asset._id,
					storageProvider: asset.storageProvider,
					deliveryBucket: asset.processedBucket ?? asset.sourceBucket ?? null,
					deliveryObjectKey: asset.processedObjectKey ?? asset.sourceObjectKey ?? null,
					mediaKind: asset.mediaKind ?? null,
					contentType: asset.contentType ?? null,
					durationSeconds: asset.durationSeconds ?? null
				};
			})
		);

		return assets.filter(Boolean);
	}
});

export const listMyUploads = query({
	args: {
		status: v.optional(mediaUploadStatusValidator)
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const rows = args.status
			? await ctx.db
					.query('mediaAssets')
					.withIndex('by_owner_and_status', (q) =>
						q.eq('ownerUserId', identity.subject).eq('status', args.status!)
					)
					.collect()
			: await ctx.db
					.query('mediaAssets')
					.withIndex('by_owner', (q) => q.eq('ownerUserId', identity.subject))
					.collect();

		return rows
			.sort((left, right) => right.createdAt - left.createdAt)
			.map((asset) => toResolvedAsset(asset));
	}
});
