import { ConvexError, v } from 'convex/values';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import {
	internalMutation,
	mutation,
	query,
	type MutationCtx,
	type QueryCtx
} from './_generated/server';
import {
	MEDIA_PIPELINE_VERSION,
	mediaUploadConstraintsValidator,
	mediaUploadStatusValidator
} from './mediaModel';
import {
	type SupportedContentType,
	type StoredMediaMetadata,
	describeUploadConstraints,
	inferSingleAcceptedMediaKind,
	normalizeUploadConstraints,
	runMediaPipeline
} from './mediaPipeline';
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

const toResolvedAsset = async (
	ctx: ReadCtx,
	asset: Doc<'mediaAssets'>
) => {
	// Frontend code should treat the upload record as the source of truth and derive
	// picker hints from this resolved constraints block, rather than re-encoding MIME
	// and size rules in each feature surface.
	const constraints = describeUploadConstraints({
		acceptedContentTypes: asset.acceptedContentTypes as SupportedContentType[],
		maxBytes: asset.maxBytes,
		enableCompression: asset.enableCompression,
		enableSafetyScreening: asset.enableSafetyScreening
	});
	const fileUrl =
		asset.status === 'ready' && asset.storageId ? await ctx.storage.getUrl(asset.storageId) : null;

	return {
		assetId: asset._id,
		ownerUserId: asset.ownerUserId,
		mediaKind: asset.mediaKind ?? null,
		status: asset.status,
		originalFilename: asset.originalFilename ?? null,
		clientContentType: asset.clientContentType ?? null,
		clientSizeBytes: asset.clientSizeBytes ?? null,
		storageId: asset.storageId ?? null,
		contentType: asset.contentType ?? null,
		sizeBytes: asset.sizeBytes ?? null,
		sha256: asset.sha256 ?? null,
		pipelineVersion: asset.pipelineVersion,
		attemptCount: asset.attemptCount,
		stepResults: asset.stepResults,
		lastFailure: asset.lastFailure ?? null,
		createdAt: asset.createdAt,
		updatedAt: asset.updatedAt,
		uploadCompletedAt: asset.uploadCompletedAt ?? null,
		readyAt: asset.readyAt ?? null,
		failedAt: asset.failedAt ?? null,
		canceledAt: asset.canceledAt ?? null,
		fileUrl,
		constraints: {
			acceptedMediaKinds: [...constraints.acceptedMediaKinds],
			acceptedContentTypes: [...constraints.acceptedContentTypes],
			acceptedFileExtensions: [...constraints.acceptedFileExtensions],
			maxBytes: constraints.maxBytes,
			enableCompression: constraints.enableCompression,
			enableSafetyScreening: constraints.enableSafetyScreening,
			accept: constraints.accept
		},
		actions: {
			canFinalize: asset.status === 'pending_upload',
			canRetry:
				asset.status === 'failed' && Boolean(asset.storageId) && Boolean(asset.lastFailure?.retryable),
			canRestart:
				asset.status === 'pending_upload' ||
				asset.status === 'failed' ||
				asset.status === 'canceled',
			canCancel:
				asset.status === 'pending_upload' ||
				asset.status === 'processing' ||
				asset.status === 'failed'
		}
	};
};

const deleteStorageObjectIfPresent = async (
	ctx: MutationCtx,
	storageId?: Id<'_storage'>
) => {
	if (!storageId) {
		return;
	}

	await ctx.storage.delete(storageId);
};

export const beginUpload = mutation({
	args: {
		constraints: mediaUploadConstraintsValidator,
		originalFilename: v.optional(v.string()),
		clientContentType: v.optional(v.string()),
		clientSizeBytes: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const now = Date.now();
		// We persist the validated constraints on the draft upload itself so later media
		// features can choose their own rules without adding new backend enum values.
		const constraints = normalizeUploadConstraints(args.constraints);
		const assetId = await ctx.db.insert('mediaAssets', {
			ownerUserId: identity.subject,
			mediaKind: inferSingleAcceptedMediaKind(constraints),
			status: 'pending_upload',
			originalFilename: args.originalFilename,
			clientContentType: args.clientContentType,
			clientSizeBytes: args.clientSizeBytes,
			acceptedContentTypes: constraints.acceptedContentTypes,
			maxBytes: constraints.maxBytes,
			enableCompression: constraints.enableCompression,
			enableSafetyScreening: constraints.enableSafetyScreening,
			pipelineVersion: MEDIA_PIPELINE_VERSION,
			attemptCount: 0,
			stepResults: [],
			createdAt: now,
			updatedAt: now
		});
		const uploadUrl = await ctx.storage.generateUploadUrl();
		const asset = await ctx.db.get(assetId);
		if (!asset) {
			throw new ConvexError('Failed to create upload');
		}

		return {
			asset: await toResolvedAsset(ctx, asset),
			uploadUrl
		};
	}
});

export const finalizeUpload = mutation({
	args: {
		assetId: v.id('mediaAssets'),
		storageId: v.id('_storage')
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const asset = await assertOwner(ctx, args.assetId, identity.subject);

		if (asset.status !== 'pending_upload') {
			throw new ConvexError('Upload is not ready to be finalized');
		}

		const duplicate = await ctx.db
			.query('mediaAssets')
			.withIndex('by_storage_id', (q) => q.eq('storageId', args.storageId))
			.first();
		if (duplicate && duplicate._id !== asset._id && duplicate.status !== 'canceled') {
			throw new ConvexError('Storage object is already attached to another upload');
		}

		const now = Date.now();
		// Finalize only records which storage object this draft should process. The heavy
		// lifting happens in the scheduled internal mutation so the client gets an explicit
		// processing state instead of waiting on validation/transforms inline.
		await ctx.db.patch(asset._id, {
			storageId: args.storageId,
			status: 'processing',
			attemptCount: asset.attemptCount + 1,
			stepResults: [],
			lastFailure: undefined,
			uploadCompletedAt: now,
			failedAt: undefined,
			canceledAt: undefined,
			updatedAt: now
		});
		await ctx.scheduler.runAfter(0, internal.media.processUpload, {
			assetId: asset._id
		});

		const updated = await ctx.db.get(asset._id);
		if (!updated) {
			throw new ConvexError('Upload not found');
		}

		return await toResolvedAsset(ctx, updated);
	}
});

export const retryProcessing = mutation({
	args: {
		assetId: v.id('mediaAssets')
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const asset = await assertOwner(ctx, args.assetId, identity.subject);

		if (asset.status !== 'failed' || !asset.storageId || !asset.lastFailure?.retryable) {
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
		await ctx.scheduler.runAfter(0, internal.media.processUpload, {
			assetId: asset._id
		});

		const updated = await ctx.db.get(asset._id);
		if (!updated) {
			throw new ConvexError('Upload not found');
		}

		return await toResolvedAsset(ctx, updated);
	}
});

export const restartUpload = mutation({
	args: {
		assetId: v.id('mediaAssets')
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const asset = await assertOwner(ctx, args.assetId, identity.subject);

		if (!['pending_upload', 'failed', 'canceled'].includes(asset.status)) {
			throw new ConvexError('Upload cannot be restarted from its current state');
		}

		await deleteStorageObjectIfPresent(ctx, asset.storageId);

		const now = Date.now();
		await ctx.db.patch(asset._id, {
			status: 'pending_upload',
			storageId: undefined,
			mediaKind: inferSingleAcceptedMediaKind({
				acceptedContentTypes: asset.acceptedContentTypes as SupportedContentType[],
				maxBytes: asset.maxBytes,
				enableCompression: asset.enableCompression,
				enableSafetyScreening: asset.enableSafetyScreening
			}),
			contentType: undefined,
			sizeBytes: undefined,
			sha256: undefined,
			stepResults: [],
			lastFailure: undefined,
			uploadCompletedAt: undefined,
			readyAt: undefined,
			failedAt: undefined,
			canceledAt: undefined,
			updatedAt: now
		});

		const updated = await ctx.db.get(asset._id);
		if (!updated) {
			throw new ConvexError('Upload not found');
		}

		return {
			asset: await toResolvedAsset(ctx, updated),
			uploadUrl: await ctx.storage.generateUploadUrl()
		};
	}
});

export const cancelUpload = mutation({
	args: {
		assetId: v.id('mediaAssets'),
		deleteStorage: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const asset = await assertOwner(ctx, args.assetId, identity.subject);

		if (asset.status === 'ready') {
			throw new ConvexError('Ready uploads must be detached by feature-level logic, not canceled');
		}

		if (args.deleteStorage ?? true) {
			await deleteStorageObjectIfPresent(ctx, asset.storageId);
		}

		await ctx.db.patch(asset._id, {
			status: 'canceled',
			storageId: args.deleteStorage ?? true ? undefined : asset.storageId,
			mediaKind: args.deleteStorage ?? true ? undefined : asset.mediaKind,
			contentType: args.deleteStorage ?? true ? undefined : asset.contentType,
			sizeBytes: args.deleteStorage ?? true ? undefined : asset.sizeBytes,
			sha256: args.deleteStorage ?? true ? undefined : asset.sha256,
			lastFailure: undefined,
			stepResults: [],
			canceledAt: Date.now(),
			updatedAt: Date.now()
		});

		const updated = await ctx.db.get(asset._id);
		if (!updated) {
			throw new ConvexError('Upload not found');
		}

		return await toResolvedAsset(ctx, updated);
	}
});

export const getUpload = query({
	args: {
		assetId: v.id('mediaAssets')
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const asset = await assertOwner(ctx, args.assetId, identity.subject);
		return await toResolvedAsset(ctx, asset);
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

		const filtered = rows.sort((left, right) => right.createdAt - left.createdAt);

		return await Promise.all(filtered.map((asset) => toResolvedAsset(ctx, asset)));
	}
});

export const processUpload = internalMutation({
	args: {
		assetId: v.id('mediaAssets')
	},
	handler: async (ctx, args) => {
		const asset = await ctx.db.get(args.assetId);
		if (!asset || asset.status !== 'processing' || !asset.storageId) {
			return null;
		}

		// Use the system table as the authoritative source for uploaded file metadata.
		// Clients may send hints, but readiness/failure should always be based on what
		// Convex actually stored.
		const metadata = (await ctx.db.system.get('_storage', asset.storageId)) as StoredMediaMetadata | null;
		const result = await runMediaPipeline({
			asset: {
				acceptedContentTypes: asset.acceptedContentTypes as SupportedContentType[],
				maxBytes: asset.maxBytes,
				enableCompression: asset.enableCompression,
				enableSafetyScreening: asset.enableSafetyScreening,
				originalFilename: asset.originalFilename ?? null,
				clientContentType: asset.clientContentType ?? null
			},
			storageMetadata: metadata
		});

		if (result.ok) {
			const now = Date.now();
			await ctx.db.patch(asset._id, {
				mediaKind: result.descriptor.mediaKind ?? asset.mediaKind,
				contentType: result.descriptor.contentType ?? undefined,
				sizeBytes: result.descriptor.sizeBytes,
				sha256: result.descriptor.sha256,
				status: 'ready',
				stepResults: result.steps,
				lastFailure: undefined,
				readyAt: now,
				failedAt: undefined,
				canceledAt: undefined,
				updatedAt: now
			});
			return await ctx.db.get(asset._id);
		}

		await ctx.db.patch(asset._id, {
			mediaKind: result.descriptor?.mediaKind ?? asset.mediaKind,
			contentType: result.descriptor?.contentType ?? asset.contentType,
			sizeBytes: result.descriptor?.sizeBytes ?? asset.sizeBytes,
			sha256: result.descriptor?.sha256 ?? asset.sha256,
			status: 'failed',
			lastFailure: result.failure,
			stepResults: result.steps,
			failedAt: Date.now(),
			updatedAt: Date.now()
		});

		return await ctx.db.get(asset._id);
	}
});
