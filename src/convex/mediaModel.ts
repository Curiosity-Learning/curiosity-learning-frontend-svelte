import { v } from 'convex/values';
import { mediaStorageProviderValidatorLiteral } from './mediaStorage';
import { mediaModerationResultValidator } from './mediaModeration';

export const MEDIA_PIPELINE_VERSION = 1;

export const MEDIA_KINDS = ['image', 'video'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

export const MEDIA_UPLOAD_STATUSES = [
	'pending_upload',
	'processing',
	'ready',
	'failed',
	'canceled'
] as const;
export type MediaUploadStatus = (typeof MEDIA_UPLOAD_STATUSES)[number];

export const MEDIA_FAILURE_STAGES = ['upload', 'validation', 'processing'] as const;
export type MediaFailureStage = (typeof MEDIA_FAILURE_STAGES)[number];

export const MEDIA_PIPELINE_STAGES = ['validation', 'processing'] as const;
export type MediaPipelineStage = (typeof MEDIA_PIPELINE_STAGES)[number];

export const MEDIA_PIPELINE_STEP_STATUSES = ['passed', 'failed', 'skipped'] as const;
export type MediaPipelineStepStatus = (typeof MEDIA_PIPELINE_STEP_STATUSES)[number];

export const mediaKindValidator = v.union(v.literal('image'), v.literal('video'));
export const mediaStorageProviderValidator = v.literal(mediaStorageProviderValidatorLiteral);

export const mediaUploadStatusValidator = v.union(
	v.literal('pending_upload'),
	v.literal('processing'),
	v.literal('ready'),
	v.literal('failed'),
	v.literal('canceled')
);

export const mediaFailureStageValidator = v.union(
	v.literal('upload'),
	v.literal('validation'),
	v.literal('processing')
);

export const mediaPipelineStageValidator = v.union(
	v.literal('validation'),
	v.literal('processing')
);

export const mediaPipelineStepStatusValidator = v.union(
	v.literal('passed'),
	v.literal('failed'),
	v.literal('skipped')
);

export const mediaPipelineStepResultValidator = v.object({
	step: v.string(),
	stage: mediaPipelineStageValidator,
	status: mediaPipelineStepStatusValidator,
	message: v.optional(v.string())
});

export const mediaFailureValidator = v.object({
	code: v.string(),
	message: v.string(),
	stage: mediaFailureStageValidator,
	recoverable: v.boolean(),
	retryable: v.boolean()
});

export const mediaUploadConstraintsValidator = v.object({
	acceptedContentTypes: v.array(v.string()),
	maxBytes: v.number(),
	enableCompression: v.optional(v.boolean()),
	enableSafetyScreening: v.optional(v.boolean())
});

export const mediaAssetFields = {
	ownerUserId: v.string(),
	mediaKind: v.optional(mediaKindValidator),
	status: mediaUploadStatusValidator,
	originalFilename: v.optional(v.string()),
	clientContentType: v.optional(v.string()),
	clientSizeBytes: v.optional(v.number()),
	clientReportedImageCompression: v.optional(v.boolean()),
	acceptedContentTypes: v.array(v.string()),
	maxBytes: v.number(),
	enableCompression: v.boolean(),
	enableSafetyScreening: v.boolean(),
	storageProvider: mediaStorageProviderValidator,
	sourceBucket: v.optional(v.string()),
	sourceObjectKey: v.optional(v.string()),
	sourceObjectRevision: v.number(),
	processedBucket: v.optional(v.string()),
	processedObjectKey: v.optional(v.string()),
	contentType: v.optional(v.string()),
	sizeBytes: v.optional(v.number()),
	durationSeconds: v.optional(v.number()),
	sha256: v.optional(v.string()),
	moderation: v.optional(mediaModerationResultValidator),
	pipelineVersion: v.number(),
	attemptCount: v.number(),
	stepResults: v.array(mediaPipelineStepResultValidator),
	lastFailure: v.optional(mediaFailureValidator),
	createdAt: v.number(),
	updatedAt: v.number(),
	uploadCompletedAt: v.optional(v.number()),
	readyAt: v.optional(v.number()),
	failedAt: v.optional(v.number()),
	canceledAt: v.optional(v.number())
};
