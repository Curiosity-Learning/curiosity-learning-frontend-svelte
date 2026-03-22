import { v } from 'convex/values';

export const MEDIA_PIPELINE_VERSION = 1;

export const MEDIA_PURPOSES = [
	'pledge_media',
	'session_photo',
	'project_media',
	'application_video'
] as const;
export type MediaPurpose = (typeof MEDIA_PURPOSES)[number];

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

export const mediaPurposeValidator = v.union(
	v.literal('pledge_media'),
	v.literal('session_photo'),
	v.literal('project_media'),
	v.literal('application_video')
);

export const mediaKindValidator = v.union(v.literal('image'), v.literal('video'));

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

export const mediaAssetFields = {
	ownerUserId: v.string(),
	purpose: mediaPurposeValidator,
	mediaKind: v.optional(mediaKindValidator),
	status: mediaUploadStatusValidator,
	contextType: v.optional(v.string()),
	contextId: v.optional(v.string()),
	originalFilename: v.optional(v.string()),
	clientContentType: v.optional(v.string()),
	clientSizeBytes: v.optional(v.number()),
	storageId: v.optional(v.id('_storage')),
	contentType: v.optional(v.string()),
	sizeBytes: v.optional(v.number()),
	sha256: v.optional(v.string()),
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
