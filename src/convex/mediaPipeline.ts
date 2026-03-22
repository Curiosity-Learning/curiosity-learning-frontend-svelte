import type { Id } from './_generated/dataModel';
import {
	MEDIA_PURPOSES,
	type MediaFailureStage,
	type MediaKind,
	type MediaPipelineStage,
	type MediaPipelineStepStatus,
	type MediaPurpose
} from './mediaModel';

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

type MediaPurposeConfig = {
	label: string;
	acceptedMediaKinds: readonly MediaKind[];
	pipeline: readonly MediaPipelinePluginName[];
};

const PURPOSE_CONFIGS: Record<MediaPurpose, MediaPurposeConfig> = {
	pledge_media: {
		label: 'Pledge media',
		acceptedMediaKinds: ['image', 'video'],
		pipeline: [
			'validate-storage-metadata',
			'validate-media-type',
			'validate-file-size',
			'compress-image',
			'compress-video',
			'safety-screening'
		]
	},
	session_photo: {
		label: 'Session photo',
		acceptedMediaKinds: ['image'],
		pipeline: [
			'validate-storage-metadata',
			'validate-media-type',
			'validate-file-size',
			'compress-image',
			'safety-screening'
		]
	},
	project_media: {
		label: 'Project media',
		acceptedMediaKinds: ['image', 'video'],
		pipeline: [
			'validate-storage-metadata',
			'validate-media-type',
			'validate-file-size',
			'compress-image',
			'compress-video',
			'safety-screening'
		]
	},
	application_video: {
		label: 'Application video',
		acceptedMediaKinds: ['video'],
		pipeline: [
			'validate-storage-metadata',
			'validate-media-type',
			'validate-file-size',
			'compress-video',
			'safety-screening'
		]
	}
};

const GENERIC_CONTENT_TYPES = new Set(['application/octet-stream', 'binary/octet-stream']);

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

type MediaSizeLimitBytesByKind = {
	image: number | null;
	video: number | null;
};

type ResolvedMediaPurposeConfig = MediaPurposeConfig & {
	acceptedContentTypes: string[];
	acceptedFileExtensions: string[];
	sizeLimitBytesByKind: MediaSizeLimitBytesByKind;
};

const buildSizeLimitBytesByKind = (
	acceptedMediaKinds: readonly MediaKind[]
): MediaSizeLimitBytesByKind => ({
	image: acceptedMediaKinds.includes('image') ? MEDIA_KIND_DEFINITIONS.image.maxBytes : null,
	video: acceptedMediaKinds.includes('video') ? MEDIA_KIND_DEFINITIONS.video.maxBytes : null
});

const buildAcceptedContentTypes = (acceptedMediaKinds: readonly MediaKind[]) =>
	[...new Set(acceptedMediaKinds.flatMap((kind) => [...MEDIA_KIND_DEFINITIONS[kind].acceptedContentTypes]))];

const buildAcceptedFileExtensions = (acceptedMediaKinds: readonly MediaKind[]) =>
	[...new Set(acceptedMediaKinds.flatMap((kind) => [...MEDIA_KIND_DEFINITIONS[kind].acceptedFileExtensions]))];

export const getMediaPurposeConfig = (purpose: MediaPurpose): ResolvedMediaPurposeConfig => {
	const config = PURPOSE_CONFIGS[purpose];
	return {
		...config,
		acceptedContentTypes: buildAcceptedContentTypes(config.acceptedMediaKinds),
		acceptedFileExtensions: buildAcceptedFileExtensions(config.acceptedMediaKinds),
		sizeLimitBytesByKind: buildSizeLimitBytesByKind(config.acceptedMediaKinds)
	};
};

export const listUploadPolicies = () =>
	MEDIA_PURPOSES.map((purpose) => {
		const config = getMediaPurposeConfig(purpose);
		return {
			purpose,
			label: config.label,
			acceptedMediaKinds: [...config.acceptedMediaKinds],
			sizeLimitBytesByKind: config.sizeLimitBytesByKind,
			acceptedContentTypes: [...config.acceptedContentTypes],
			acceptedFileExtensions: [...config.acceptedFileExtensions],
			pipeline: [...config.pipeline],
			accept: [...config.acceptedContentTypes, ...config.acceptedFileExtensions].join(',')
		};
	});

export type StoredMediaMetadata = {
	_id: Id<'_storage'>;
	_creationTime: number;
	contentType?: string;
	sha256: string;
	size: number;
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
	storageId: Id<'_storage'>;
	mediaKind: MediaKind | null;
	contentType: string | null;
	sizeBytes: number;
	sha256: string;
};

export type MediaPipelineAssetSnapshot = {
	purpose: MediaPurpose;
	originalFilename?: string | null;
	clientContentType?: string | null;
};

type MediaPipelinePluginContext = {
	asset: MediaPipelineAssetSnapshot;
	config: ResolvedMediaPurposeConfig;
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

const detectMediaKind = ({
	contentType,
	fileExtension,
	acceptedMediaKinds
}: {
	contentType: string | null;
	fileExtension: string | null;
	acceptedMediaKinds: readonly MediaKind[];
}) => {
	for (const kind of acceptedMediaKinds) {
		const definition = MEDIA_KIND_DEFINITIONS[kind];
		if (
			contentType &&
			(definition.acceptedContentTypes as readonly string[]).includes(contentType)
		) {
			return kind;
		}
		if (
			fileExtension &&
			(definition.acceptedFileExtensions as readonly string[]).includes(fileExtension)
		) {
			return kind;
		}
	}

	return null;
};

const PLUGIN_REGISTRY: Record<MediaPipelinePluginName, MediaPipelinePlugin> = {
	'validate-storage-metadata': {
		name: 'validate-storage-metadata',
		stage: 'validation',
		run: async ({ descriptor }) => {
			if (!descriptor.sha256 || descriptor.sizeBytes < 0) {
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
				acceptedMediaKinds: config.acceptedMediaKinds
			});

			if (!mediaKind) {
				return {
					status: 'failed',
					message: 'File type is not allowed for this upload purpose.',
					failure: buildValidationFailure(
						'unsupported_media_type',
						`Allowed file types for ${config.label.toLowerCase()} are ${config.acceptedFileExtensions.join(', ')}.`
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

			const maxBytes = config.sizeLimitBytesByKind[descriptor.mediaKind];
			if (maxBytes && descriptor.sizeBytes > maxBytes) {
				const maxMegabytes = Math.round(maxBytes / (1024 * 1024));
				return {
					status: 'failed',
					message: 'File exceeds the configured size limit.',
					failure: buildValidationFailure(
						'file_too_large',
						`${config.label} ${descriptor.mediaKind} uploads must be ${maxMegabytes}MB or smaller.`
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
		run: async () => ({
			status: 'skipped',
			message: 'Image compression hook is configured as a no-op until a compressor is installed.'
		})
	},
	'compress-video': {
		name: 'compress-video',
		stage: 'processing',
		run: async () => ({
			status: 'skipped',
			message: 'Video compression hook is configured as a no-op until a compressor is installed.'
		})
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

	const config = getMediaPurposeConfig(asset.purpose);
	let descriptor: MediaPipelineDescriptor = {
		storageId: storageMetadata._id,
		mediaKind: null,
		contentType: getEffectiveContentType({
			storedContentType: storageMetadata.contentType ?? null,
			clientContentType: asset.clientContentType
		}),
		sizeBytes: storageMetadata.size,
		sha256: storageMetadata.sha256
	};

	const steps: MediaPipelineStepResult[] = [];

	for (const pluginName of config.pipeline) {
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
