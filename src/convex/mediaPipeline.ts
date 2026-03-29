import {
	type MediaFailureStage,
	type MediaKind,
	type MediaPipelineStage,
	type MediaPipelineStepStatus
} from './mediaModel';
import type { MediaStorageProvider } from './mediaStorage';

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
		maxBytes: mb(250)
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
export const MAX_SUPPORTED_UPLOAD_BYTES = mb(250);
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

const getFileExtension = (filename?: string | null) => {
	if (!filename) {
		return null;
	}

	const normalized = filename.trim().toLowerCase();
	const lastDot = normalized.lastIndexOf('.');
	if (lastDot < 0) {
		return null;
	}

	return normalized.slice(lastDot);
};

const isGenericContentType = (contentType: string | null) =>
	Boolean(contentType && GENERIC_CONTENT_TYPES.has(contentType));

const getEffectiveContentType = ({
	storedContentType,
	clientContentType
}: {
	storedContentType?: string | null;
	clientContentType?: string | null;
}) => {
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

type MediaPipelineDescriptor = {
	storageProvider: MediaStorageProvider;
	bucket: string;
	objectKey: string;
	mediaKind: MediaKind | null;
	contentType: string | null;
	sizeBytes: number;
	durationSeconds: number | null;
	sha256: string | null;
};

export type MediaPipelineAssetSnapshot = NormalizedUploadConstraints & {
	originalFilename?: string | null;
	clientContentType?: string | null;
};

type MediaPipelinePluginContext = {
	asset: MediaPipelineAssetSnapshot;
	config: ReturnType<typeof describeUploadConstraints>;
	descriptor: MediaPipelineDescriptor;
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
	fileExtension,
	acceptedContentTypes
}: {
	contentType: string | null;
	fileExtension: string | null;
	acceptedContentTypes: readonly SupportedContentType[];
}) => {
	for (const acceptedContentType of acceptedContentTypes) {
		const mediaKind = getMediaKindForContentType(acceptedContentType);
		const extensions = getFileExtensionsForContentType(acceptedContentType);

		if (contentType && acceptedContentType === contentType) {
			return mediaKind;
		}

		if (fileExtension && (extensions as readonly string[]).includes(fileExtension)) {
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
			const extension = getFileExtension(asset.originalFilename);
			const contentType = getEffectiveContentType({
				storedContentType: descriptor.contentType,
				clientContentType: asset.clientContentType
			});
			const mediaKind = detectMediaKind({
				contentType,
				fileExtension: extension,
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
				message: contentType
					? `Accepted ${MEDIA_KIND_DEFINITIONS[mediaKind].label.toLowerCase()} upload (${contentType}).`
					: 'Accepted upload using filename extension fallback.'
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
		run: async ({ descriptor }) =>
			descriptor.mediaKind === 'image'
				? {
						status: 'skipped',
						message:
							'Image compression hook is configured as a no-op until a compressor is installed.'
					}
				: {
						status: 'skipped',
						message: 'Image compression skipped for non-image upload.'
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
		run: async () => ({
			status: 'skipped',
			message: 'Media safety screening is intentionally wired as a pipeline step but not yet enabled.'
		})
	}
};

export const runMediaPipeline = async ({
	asset,
	storageMetadata
}: {
	asset: MediaPipelineAssetSnapshot;
	storageMetadata: StoredMediaMetadata | null;
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
		contentType: getEffectiveContentType({
			storedContentType: storageMetadata.contentType ?? null,
			clientContentType: asset.clientContentType
		}),
		sizeBytes: storageMetadata.size,
		durationSeconds: normalizeDurationSeconds(storageMetadata.durationSeconds ?? null),
		sha256: storageMetadata.sha256 ?? null
	};

	const steps: MediaPipelineStepResult[] = [];

	for (const pluginName of buildPipelinePlugins(asset)) {
		const plugin = PLUGIN_REGISTRY[pluginName];
		const result = await plugin.run({
			asset,
			config,
			descriptor
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
