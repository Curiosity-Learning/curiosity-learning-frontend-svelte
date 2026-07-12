import {
	type MediaFailureStage,
	type MediaKind,
	type MediaPipelineStage,
	type MediaPipelineStepStatus
} from './mediaModel';
import type { MediaStorageProvider } from './mediaStorage';
import {
	decideMediaModerationStatus,
	MAX_SCREENABLE_IMAGE_BYTES,
	type MediaModerationLabel,
	type MediaModerationResult
} from './mediaModeration';

export const MEDIA_SAFETY_SCREENING_BLOCKED_MESSAGE =
	'This image/video could not be uploaded. If you believe this is an error, please try a different file.';

const mb = (value: number) => value * 1024 * 1024;

const IMAGE_CONTENT_TYPES = [
	'image/jpeg',
	'image/png',
	'image/webp',
	'image/heic',
	'image/heif'
] as const;

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif'] as const;

const VIDEO_CONTENT_TYPES = [
	'video/mp4',
	'video/quicktime',
	'video/webm',
	'video/x-m4v'
] as const;

const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.webm', '.m4v'] as const;

// Canonical hard caps (CEO decision: 100MB for video). `image`'s cap here is documentation/
// extension-lookup only — the enforced per-upload cap is whatever `maxBytes` the caller passed at
// asset-creation time (see `normalizeUploadConstraints` below), which itself can never exceed
// `MAX_SUPPORTED_UPLOAD_BYTES`. Keeping `MAX_SUPPORTED_UPLOAD_BYTES` at the video cap means no
// caller — including a compromised/malicious client hitting the mutation directly — can ever
// request a bigger allowance than the canonical video limit, closing the gap where this used to
// be a lax 250MB ceiling regardless of media kind.
const MEDIA_KIND_DEFINITIONS = {
	image: {
		label: 'Image',
		acceptedContentTypes: IMAGE_CONTENT_TYPES,
		acceptedFileExtensions: IMAGE_EXTENSIONS,
		maxBytes: mb(20)
	},
	video: {
		label: 'Video',
		acceptedContentTypes: VIDEO_CONTENT_TYPES,
		acceptedFileExtensions: VIDEO_EXTENSIONS,
		maxBytes: mb(100)
	}
} as const;

type MediaPipelinePluginName =
	| 'validate-storage-metadata'
	| 'validate-media-type'
	| 'validate-file-size'
	| 'compress-image'
	| 'compress-video'
	| 'safety-screening';

const GENERIC_CONTENT_TYPES = new Set(['application/octet-stream', 'binary/octet-stream']);
// Canonical 100MB hard cap (CEO decision), matching HUNDRED_MB in
// src/lib/media/media-field.svelte.ts — the actual per-field client constraints (club video,
// mixed update attachments) already request <=100MB; this is the server-side ceiling that no
// caller's declared `maxBytes` may exceed, previously a stale 250MB (see MEDIA_KIND_DEFINITIONS
// comment above).
export const MAX_SUPPORTED_UPLOAD_BYTES = mb(100);
export const SUPPORTED_CONTENT_TYPES = [...IMAGE_CONTENT_TYPES, ...VIDEO_CONTENT_TYPES] as const;
export type SupportedContentType = (typeof SUPPORTED_CONTENT_TYPES)[number];

type NormalizedUploadConstraints = {
	acceptedContentTypes: SupportedContentType[];
	maxBytes: number;
	enableCompression: boolean;
	enableSafetyScreening: boolean;
};

const normalizeContentType = (value?: string | null) => {
	if (!value) {
		return null;
	}

	const [rawType] = value.trim().toLowerCase().split(';');
	return rawType || null;
};

const isGenericContentType = (contentType: string | null) =>
	Boolean(contentType && GENERIC_CONTENT_TYPES.has(contentType));

const getEffectiveContentType = ({
	detectedContentType,
	storedContentType,
	clientContentType
}: {
	detectedContentType?: SupportedContentType | null;
	storedContentType?: string | null;
	clientContentType?: string | null;
}) => {
	if (detectedContentType) {
		return detectedContentType;
	}

	const normalizedStored = normalizeContentType(storedContentType);
	if (normalizedStored && !isGenericContentType(normalizedStored)) {
		return normalizedStored;
	}

	const normalizedClient = normalizeContentType(clientContentType);
	return normalizedClient;
};

const normalizeDurationSeconds = (value?: number | null) =>
	typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;

const SUPPORTED_CONTENT_TYPE_SET = new Set<string>(SUPPORTED_CONTENT_TYPES);

const buildAcceptedMediaKinds = (acceptedContentTypes: readonly SupportedContentType[]) =>
	[...new Set(acceptedContentTypes.map((contentType) => getMediaKindForContentType(contentType)))];

const buildAcceptedFileExtensions = (acceptedContentTypes: readonly SupportedContentType[]) =>
	[
		...new Set(
			acceptedContentTypes.flatMap((contentType) => getFileExtensionsForContentType(contentType))
		)
	];

export type StoredMediaMetadata = {
	storageProvider: MediaStorageProvider;
	bucket: string;
	objectKey: string;
	detectedContentType?: SupportedContentType | null;
	contentType?: string | null;
	sha256?: string | null;
	size: number;
	durationSeconds?: number | null;
	eTag?: string | null;
	lastModified?: number | null;
};

export type MediaPipelineFailure = {
	code: string;
	message: string;
	stage: MediaFailureStage;
	recoverable: boolean;
	retryable: boolean;
};

export type MediaPipelineStepResult = {
	step: string;
	stage: MediaPipelineStage;
	status: MediaPipelineStepStatus;
	message?: string;
};

export const IMAGE_COMPRESSION_OUTCOMES = ['client-compressed', 'skipped'] as const;
export type ImageCompressionOutcome = (typeof IMAGE_COMPRESSION_OUTCOMES)[number];

export type MediaPipelineDescriptor = {
	storageProvider: MediaStorageProvider;
	bucket: string;
	objectKey: string;
	mediaKind: MediaKind | null;
	detectedContentType: SupportedContentType | null;
	contentType: string | null;
	sizeBytes: number;
	durationSeconds: number | null;
	sha256: string | null;
	moderation: MediaModerationResult | null;
};

export type MediaImageModerator = (context: {
	bucket: string;
	objectKey: string;
}) => Promise<MediaModerationLabel[]>;

export type MediaPipelineAssetSnapshot = NormalizedUploadConstraints & {
	originalFilename?: string | null;
	clientContentType?: string | null;
	/**
	 * Set by the client when it has already compressed the image before
	 * upload (canvas/OffscreenCanvas re-encode). When absent, the
	 * compress-image step records 'skipped' rather than fabricating a
	 * compression result.
	 */
	clientReportedImageCompression?: boolean;
};

type MediaPipelinePluginContext = {
	asset: MediaPipelineAssetSnapshot;
	config: ReturnType<typeof describeUploadConstraints>;
	descriptor: MediaPipelineDescriptor;
	moderateImage?: MediaImageModerator;
};

type MediaPipelinePluginResult = {
	status: MediaPipelineStepStatus;
	message?: string;
	failure?: MediaPipelineFailure;
	patch?: Partial<MediaPipelineDescriptor>;
};

type MediaPipelinePlugin = {
	name: MediaPipelinePluginName;
	stage: MediaPipelineStage;
	run: (context: MediaPipelinePluginContext) => Promise<MediaPipelinePluginResult>;
};

const buildValidationFailure = (
	code: string,
	message: string,
	retryable = false
): MediaPipelineFailure => ({
	code,
	message,
	stage: 'validation',
	recoverable: true,
	retryable
});

const getMediaKindForContentType = (contentType: SupportedContentType): MediaKind => {
	if ((IMAGE_CONTENT_TYPES as readonly string[]).includes(contentType)) {
		return 'image';
	}

	return 'video';
};

const getFileExtensionsForContentType = (contentType: SupportedContentType) => {
	const mediaKind = getMediaKindForContentType(contentType);
	return [...MEDIA_KIND_DEFINITIONS[mediaKind].acceptedFileExtensions];
};

export const normalizeUploadConstraints = (input: {
	acceptedContentTypes: string[];
	maxBytes: number;
	enableCompression?: boolean;
	enableSafetyScreening?: boolean;
}): NormalizedUploadConstraints => {
	const acceptedContentTypes = [...new Set(input.acceptedContentTypes.map((contentType) => normalizeContentType(contentType)).filter(Boolean))] as string[];

	if (!acceptedContentTypes.length) {
		throw new Error('At least one accepted content type is required.');
	}

	const unsupported = acceptedContentTypes.filter(
		(contentType) => !SUPPORTED_CONTENT_TYPE_SET.has(contentType)
	);
	if (unsupported.length) {
		throw new Error(`Unsupported content types: ${unsupported.join(', ')}`);
	}

	if (!Number.isFinite(input.maxBytes) || input.maxBytes <= 0) {
		throw new Error('maxBytes must be a positive number.');
	}

	if (input.maxBytes > MAX_SUPPORTED_UPLOAD_BYTES) {
		throw new Error(
			`maxBytes exceeds the supported limit of ${MAX_SUPPORTED_UPLOAD_BYTES} bytes.`
		);
	}

	return {
		acceptedContentTypes: acceptedContentTypes as SupportedContentType[],
		maxBytes: Math.floor(input.maxBytes),
		enableCompression: input.enableCompression ?? false,
		enableSafetyScreening: input.enableSafetyScreening ?? false
	};
};

export const describeUploadConstraints = (constraints: NormalizedUploadConstraints) => {
	const acceptedMediaKinds = buildAcceptedMediaKinds(constraints.acceptedContentTypes);
	const acceptedFileExtensions = buildAcceptedFileExtensions(constraints.acceptedContentTypes);
	return {
		...constraints,
		acceptedMediaKinds,
		acceptedFileExtensions,
		accept: [...constraints.acceptedContentTypes, ...acceptedFileExtensions].join(',')
	};
};

export const inferSingleAcceptedMediaKind = (constraints: NormalizedUploadConstraints) => {
	const acceptedMediaKinds = buildAcceptedMediaKinds(constraints.acceptedContentTypes);
	return acceptedMediaKinds.length === 1 ? acceptedMediaKinds[0] : undefined;
};

const buildPipelinePlugins = (constraints: NormalizedUploadConstraints): MediaPipelinePluginName[] => {
	const steps: MediaPipelinePluginName[] = [
		'validate-storage-metadata',
		'validate-media-type',
		'validate-file-size'
	];

	if (constraints.enableCompression) {
		steps.push('compress-image', 'compress-video');
	}

	if (constraints.enableSafetyScreening) {
		steps.push('safety-screening');
	}

	return steps;
};

const detectMediaKind = ({
	contentType,
	acceptedContentTypes
}: {
	contentType: string | null;
	acceptedContentTypes: readonly SupportedContentType[];
}) => {
	for (const acceptedContentType of acceptedContentTypes) {
		const mediaKind = getMediaKindForContentType(acceptedContentType);

		if (contentType && acceptedContentType === contentType) {
			return mediaKind;
		}
	}

	return null;
};

const PLUGIN_REGISTRY: Record<MediaPipelinePluginName, MediaPipelinePlugin> = {
	'validate-storage-metadata': {
		name: 'validate-storage-metadata',
		stage: 'validation',
		run: async ({ descriptor }) => {
			if (!descriptor.objectKey || descriptor.sizeBytes < 0) {
				return {
					status: 'failed',
					message: 'Stored file metadata is incomplete.',
					failure: buildValidationFailure(
						'missing_storage_metadata',
						'Upload metadata could not be read from storage.'
					)
				};
			}

			return {
				status: 'passed',
				message: 'Stored file metadata was loaded.'
			};
		}
	},
	'validate-media-type': {
		name: 'validate-media-type',
		stage: 'validation',
		run: async ({ asset, config, descriptor }) => {
			if (!descriptor.detectedContentType) {
				return {
					status: 'failed',
					message: 'The uploaded file signature does not match a supported media format.',
					failure: buildValidationFailure(
						'unsupported_media_signature',
						'The uploaded file could not be verified as a supported image or video format.'
					)
				};
			}

			const contentType = getEffectiveContentType({
				detectedContentType: descriptor.detectedContentType,
				storedContentType: descriptor.contentType,
				clientContentType: asset.clientContentType
			});
			const mediaKind = detectMediaKind({
				contentType,
				acceptedContentTypes: config.acceptedContentTypes
			});

			if (!mediaKind) {
				return {
					status: 'failed',
					message: 'File type is not allowed for this upload.',
					failure: buildValidationFailure(
						'unsupported_media_type',
						`Allowed file types are ${config.acceptedFileExtensions.join(', ')}.`
					)
				};
			}

			return {
				status: 'passed',
				patch: {
					mediaKind,
					contentType
				},
				message: `Accepted ${MEDIA_KIND_DEFINITIONS[mediaKind].label.toLowerCase()} upload via file signature (${contentType}).`
			};
		}
	},
	'validate-file-size': {
		name: 'validate-file-size',
		stage: 'validation',
		run: async ({ config, descriptor }) => {
			if (!descriptor.mediaKind) {
				return {
					status: 'failed',
					message: 'The pipeline could not determine the media kind.',
					failure: buildValidationFailure(
						'undetermined_media_kind',
						'The uploaded file could not be classified as an allowed image or video.'
					)
				};
			}

			if (descriptor.sizeBytes <= 0) {
				return {
					status: 'failed',
					message: 'Empty files cannot be processed.',
					failure: buildValidationFailure('empty_file', 'The uploaded file is empty.')
				};
			}

			if (descriptor.sizeBytes > config.maxBytes) {
				const maxMegabytes = Math.round(config.maxBytes / (1024 * 1024));
				return {
					status: 'failed',
					message: 'File exceeds the configured size limit.',
					failure: buildValidationFailure(
						'file_too_large',
						`Uploads must be ${maxMegabytes}MB or smaller.`
					)
				};
			}

			return {
				status: 'passed',
				message: 'File size is within the configured limit.'
			};
		}
	},
	'compress-image': {
		name: 'compress-image',
		stage: 'processing',
		run: async ({ asset, descriptor }) => {
			if (descriptor.mediaKind !== 'image') {
				return {
					status: 'skipped',
					message: 'Image compression skipped for non-image upload.'
				};
			}

			// Compression happens client-side (canvas/OffscreenCanvas re-encode)
			// before the file reaches storage. This step is a verification/no-op
			// that records what the client reported rather than compressing
			// server-side (sharp is not viable inside a Convex Node action).
			if (asset.clientReportedImageCompression) {
				return {
					status: 'passed',
					message: 'Client reported the image was compressed before upload.'
				};
			}

			return {
				status: 'skipped',
				message:
					'Client did not report pre-upload compression; image was stored as received (animations pass through unmodified).'
			};
		}
	},
	'compress-video': {
		name: 'compress-video',
		stage: 'processing',
		run: async ({ descriptor }) =>
			descriptor.mediaKind === 'video'
				? {
						status: 'skipped',
						message:
							'Video compression hook is configured as a no-op until a compressor is installed.'
					}
				: {
						status: 'skipped',
						message: 'Video compression skipped for non-video upload.'
					}
	},
	'safety-screening': {
		name: 'safety-screening',
		stage: 'processing',
		run: async ({ descriptor, moderateImage }) => {
			if (descriptor.mediaKind === 'video') {
				return {
					status: 'skipped',
					message:
						'Video NSFW screening is out of scope for v1 (requires async Rekognition video jobs + SNS); marked skipped-video.',
					patch: {
						moderation: {
							status: 'skipped-video',
							labels: []
						}
					}
				};
			}

			if (descriptor.mediaKind !== 'image' || !moderateImage) {
				return {
					status: 'skipped',
					message: 'Media safety screening is not configured for this media kind.'
				};
			}

			if (descriptor.sizeBytes > MAX_SCREENABLE_IMAGE_BYTES) {
				// Rekognition's byte-payload API caps at 5MB; a truncated image
				// would be rejected as invalid, so route oversized images to human
				// review instead of screening them automatically.
				return {
					status: 'passed',
					message:
						'Image exceeds the automated screening size limit; flagged for human review.',
					patch: {
						moderation: {
							status: 'flagged',
							labels: []
						}
					}
				};
			}

			// Rekognition DetectModerationLabels only accepts JPEG and PNG. Other
			// image formats we accept (e.g. WebP, GIF) can't be auto-screened, so
			// route them to human review — same policy as the oversized case.
			// (Client compression re-encodes to JPEG, so this mostly catches
			// files uploaded in those formats unmodified.)
			if (
				descriptor.contentType !== 'image/jpeg' &&
				descriptor.contentType !== 'image/png'
			) {
				return {
					status: 'passed',
					message: `Automated screening does not support ${descriptor.contentType ?? 'this format'}; flagged for human review.`,
					patch: {
						moderation: {
							status: 'flagged',
							labels: []
						}
					}
				};
			}

			let labels: MediaModerationLabel[];
			try {
				labels = await moderateImage({
					bucket: descriptor.bucket,
					objectKey: descriptor.objectKey
				});
			} catch (error) {
				// A screening crash previously aborted the whole pipeline and left
				// the asset stuck in 'processing' forever. Fail safe instead: allow
				// the upload but flag it for human review.
				const name = error instanceof Error ? error.name : 'UnknownError';
				return {
					status: 'passed',
					message: `Automated screening errored (${name}); flagged for human review.`,
					patch: {
						moderation: {
							status: 'flagged',
							labels: []
						}
					}
				};
			}
			const moderation = decideMediaModerationStatus(labels);

			if (moderation.status === 'blocked') {
				return {
					status: 'failed',
					message: `Safety screening blocked this upload (max confidence ${moderation.maxConfidence ?? 'n/a'}).`,
					patch: { moderation },
					failure: {
						code: 'blocked_by_safety_screening',
						message: MEDIA_SAFETY_SCREENING_BLOCKED_MESSAGE,
						stage: 'processing',
						recoverable: false,
						retryable: false
					}
				};
			}

			return {
				status: 'passed',
				message:
					moderation.status === 'flagged'
						? `Safety screening flagged this upload for review (max confidence ${moderation.maxConfidence ?? 'n/a'}).`
						: 'Safety screening found no moderation labels.',
				patch: { moderation }
			};
		}
	}
};

export const runMediaPipeline = async ({
	asset,
	storageMetadata,
	moderateImage
}: {
	asset: MediaPipelineAssetSnapshot;
	storageMetadata: StoredMediaMetadata | null;
	moderateImage?: MediaImageModerator;
}) => {
	if (!storageMetadata) {
		return {
			ok: false as const,
			descriptor: null,
			steps: [
				{
					step: 'validate-storage-metadata',
					stage: 'validation',
					status: 'failed',
					message: 'Upload metadata could not be found in storage.'
				}
			] satisfies MediaPipelineStepResult[],
			failure: buildValidationFailure(
				'missing_storage_metadata',
				'Upload metadata could not be read from storage.'
			)
		};
	}

	const config = describeUploadConstraints(asset);
	let descriptor: MediaPipelineDescriptor = {
		storageProvider: storageMetadata.storageProvider,
		bucket: storageMetadata.bucket,
		objectKey: storageMetadata.objectKey,
		mediaKind: null,
		detectedContentType: storageMetadata.detectedContentType ?? null,
		contentType: getEffectiveContentType({
			detectedContentType: storageMetadata.detectedContentType ?? null,
			storedContentType: storageMetadata.contentType ?? null,
			clientContentType: asset.clientContentType
		}),
		sizeBytes: storageMetadata.size,
		durationSeconds: normalizeDurationSeconds(storageMetadata.durationSeconds ?? null),
		sha256: storageMetadata.sha256 ?? null,
		moderation: null
	};

	const steps: MediaPipelineStepResult[] = [];

	for (const pluginName of buildPipelinePlugins(asset)) {
		const plugin = PLUGIN_REGISTRY[pluginName];
		const result = await plugin.run({
			asset,
			config,
			descriptor,
			moderateImage
		});

		steps.push({
			step: plugin.name,
			stage: plugin.stage,
			status: result.status,
			message: result.message
		});

		if (result.patch) {
			descriptor = {
				...descriptor,
				...result.patch
			};
		}

		if (result.status === 'failed') {
			return {
				ok: false as const,
				descriptor,
				steps,
				failure:
					result.failure ??
					buildValidationFailure('pipeline_failed', 'The media pipeline reported a failure.')
			};
		}
	}

	return {
		ok: true as const,
		descriptor,
		steps
	};
};
