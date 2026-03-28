import type { Doc } from './_generated/dataModel';
import {
	type NormalizedUploadConstraints,
	type SupportedContentType,
	MAX_SUPPORTED_UPLOAD_BYTES,
	SUPPORTED_CONTENT_TYPES,
	assetSatisfiesUploadConstraints,
	normalizeUploadConstraints
} from './mediaPipeline';

export const PROJECT_UPDATE_MEDIA_CONSTRAINTS = normalizeUploadConstraints({
	acceptedContentTypes: [...SUPPORTED_CONTENT_TYPES],
	maxBytes: MAX_SUPPORTED_UPLOAD_BYTES,
	maxDurationSeconds: 120,
	enableCompression: true,
	enableSafetyScreening: true
});

export const buildUploadDefaults = (
	overrides: Partial<NormalizedUploadConstraints> = {}
): NormalizedUploadConstraints =>
	normalizeUploadConstraints({
		acceptedContentTypes:
			(overrides.acceptedContentTypes as SupportedContentType[] | undefined) ??
			[...SUPPORTED_CONTENT_TYPES],
		maxBytes: overrides.maxBytes ?? MAX_SUPPORTED_UPLOAD_BYTES,
		maxDurationSeconds: overrides.maxDurationSeconds,
		enableCompression: overrides.enableCompression ?? true,
		enableSafetyScreening: overrides.enableSafetyScreening ?? true
	});

export const isApprovedMediaAsset = (
	asset: Pick<Doc<'mediaAssets'>, 'status' | 'moderationStatus' | 'storageId'>
) =>
	asset.status === 'ready' &&
	asset.moderationStatus === 'approved' &&
	Boolean(asset.storageId);

export const canAttachToProjectUpdate = (
	asset: Pick<
		Doc<'mediaAssets'>,
		| 'status'
		| 'moderationStatus'
		| 'storageId'
		| 'acceptedContentTypes'
		| 'maxBytes'
		| 'maxDurationSeconds'
		| 'enableCompression'
		| 'enableSafetyScreening'
	>
) =>
	isApprovedMediaAsset(asset) &&
	assetSatisfiesUploadConstraints(asset, PROJECT_UPDATE_MEDIA_CONSTRAINTS);

// TODO(CL-685): Add feature-level policy helpers for pledge uploads when that surface is introduced.
// TODO(CL-685): Add feature-level policy helpers for session photo uploads when that surface is introduced.
// TODO(CL-685): Add feature-level policy helpers for project cover images when that surface is introduced.
// TODO(CL-685): Add a dedicated application video upload policy when the raw URL flow migrates to mediaAssets.
