import type { Doc } from './_generated/dataModel';
import { type SupportedContentType, describeUploadConstraints } from './mediaPipeline';

export const toResolvedAsset = (asset: Doc<'mediaAssets'>) => {
	const constraints = describeUploadConstraints({
		acceptedContentTypes: asset.acceptedContentTypes as SupportedContentType[],
		maxBytes: asset.maxBytes,
		enableCompression: asset.enableCompression,
		enableSafetyScreening: asset.enableSafetyScreening
	});

	return {
		assetId: asset._id,
		ownerUserId: asset.ownerUserId,
		mediaKind: asset.mediaKind ?? null,
		status: asset.status,
		originalFilename: asset.originalFilename ?? null,
		clientContentType: asset.clientContentType ?? null,
		clientSizeBytes: asset.clientSizeBytes ?? null,
		storageProvider: asset.storageProvider,
		sourceBucket: asset.sourceBucket ?? null,
		sourceObjectKey: asset.sourceObjectKey ?? null,
		processedBucket: asset.processedBucket ?? null,
		processedObjectKey: asset.processedObjectKey ?? null,
		contentType: asset.contentType ?? null,
		sizeBytes: asset.sizeBytes ?? null,
		durationSeconds: asset.durationSeconds ?? null,
		sha256: asset.sha256 ?? null,
		moderation: asset.moderation ?? null,
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
			canFinalize: asset.status === 'pending_upload' && Boolean(asset.sourceObjectKey),
			canRetry:
				asset.status === 'failed' &&
				Boolean(asset.sourceObjectKey) &&
				Boolean(asset.lastFailure?.retryable),
			canCancel:
				asset.status === 'pending_upload' ||
				asset.status === 'processing' ||
				asset.status === 'failed'
		}
	};
};
