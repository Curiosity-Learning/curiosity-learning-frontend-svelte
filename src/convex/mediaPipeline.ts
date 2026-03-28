import type { Id } from './_generated/dataModel';
import type {
	MediaFailureStage,
	MediaKind,
	MediaPipelineStage,
	MediaPipelineStepStatus
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

const GENERIC_CONTENT_TYPES = new Set(['application/octet-stream', 'binary/octet-stream']);

export const USER_SAFE_REJECTED_UPLOAD_MESSAGE =
	"This file couldn't be uploaded. Please choose a different image or video.";
export const MAX_SUPPORTED_UPLOAD_BYTES = mb(250);
export const MAX_SUPPORTED_VIDEO_DURATION_SECONDS = 10 * 60;
export const SUPPORTED_CONTENT_TYPES = [...IMAGE_CONTENT_TYPES, ...VIDEO_CONTENT_TYPES] as const;
export type SupportedContentType = (typeof SUPPORTED_CONTENT_TYPES)[number];

export type NormalizedUploadConstraints = {
	acceptedContentTypes: SupportedContentType[];
	maxBytes: number;
	maxDurationSeconds?: number;
	enableCompression: boolean;
	enableSafetyScreening: boolean;
};

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

export const normalizeContentType = (value?: string | null) => {
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

export const getEffectiveContentType = ({
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

	return normalizeContentType(clientContentType);
};

const SUPPORTED_CONTENT_TYPE_SET = new Set<string>(SUPPORTED_CONTENT_TYPES);

export const isSupportedContentType = (
	contentType: string | null | undefined
): contentType is SupportedContentType => Boolean(contentType && SUPPORTED_CONTENT_TYPE_SET.has(contentType));

const buildAcceptedMediaKinds = (acceptedContentTypes: readonly SupportedContentType[]) =>
	[...new Set(acceptedContentTypes.map((contentType) => getMediaKindForContentType(contentType)))];

const buildAcceptedFileExtensions = (acceptedContentTypes: readonly SupportedContentType[]) =>
	[
		...new Set(
			acceptedContentTypes.flatMap((contentType) => getFileExtensionsForContentType(contentType))
		)
	];

export const getMediaKindForContentType = (contentType: SupportedContentType): MediaKind => {
	if ((IMAGE_CONTENT_TYPES as readonly string[]).includes(contentType)) {
		return 'image';
	}

	return 'video';
};

export const getFileExtensionsForContentType = (contentType: SupportedContentType) => {
	const mediaKind = getMediaKindForContentType(contentType);
	return [...MEDIA_KIND_DEFINITIONS[mediaKind].acceptedFileExtensions];
};

export const normalizeUploadConstraints = (input: {
	acceptedContentTypes: string[];
	maxBytes: number;
	maxDurationSeconds?: number;
	enableCompression?: boolean;
	enableSafetyScreening?: boolean;
}): NormalizedUploadConstraints => {
	const acceptedContentTypes = [
		...new Set(
			input.acceptedContentTypes
				.map((contentType) => normalizeContentType(contentType))
				.filter((contentType): contentType is string => Boolean(contentType))
		)
	] as string[];

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

	const acceptedKinds = buildAcceptedMediaKinds(acceptedContentTypes as SupportedContentType[]);
	const includesVideo = acceptedKinds.includes('video');
	let maxDurationSeconds: number | undefined;

	if (input.maxDurationSeconds != null) {
		if (!Number.isFinite(input.maxDurationSeconds) || input.maxDurationSeconds <= 0) {
			throw new Error('maxDurationSeconds must be a positive number when provided.');
		}

		if (!includesVideo) {
			throw new Error('maxDurationSeconds can only be set for uploads that allow video.');
		}

		if (input.maxDurationSeconds > MAX_SUPPORTED_VIDEO_DURATION_SECONDS) {
			throw new Error(
				`maxDurationSeconds exceeds the supported limit of ${MAX_SUPPORTED_VIDEO_DURATION_SECONDS} seconds.`
			);
		}

		maxDurationSeconds = Math.floor(input.maxDurationSeconds);
	}

	return {
		acceptedContentTypes: acceptedContentTypes as SupportedContentType[],
		maxBytes: Math.floor(input.maxBytes),
		maxDurationSeconds,
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

export const resolveAcceptedContentType = ({
	contentType,
	acceptedContentTypes
}: {
	contentType: string | null;
	acceptedContentTypes: readonly SupportedContentType[];
}) => {
	const normalized = normalizeContentType(contentType);
	if (!normalized || !SUPPORTED_CONTENT_TYPE_SET.has(normalized)) {
		return null;
	}

	return acceptedContentTypes.includes(normalized as SupportedContentType)
		? (normalized as SupportedContentType)
		: null;
};

export const resolveMediaKindFromUpload = ({
	contentType,
	acceptedContentTypes
}: {
	contentType: string | null;
	acceptedContentTypes: readonly SupportedContentType[];
}) => {
	const acceptedContentType = resolveAcceptedContentType({
		contentType,
		acceptedContentTypes
	});
	return acceptedContentType ? getMediaKindForContentType(acceptedContentType) : null;
};

export const assetSatisfiesUploadConstraints = (
	asset: {
		acceptedContentTypes: string[];
		maxBytes: number;
		maxDurationSeconds?: number | null;
		enableCompression: boolean;
		enableSafetyScreening: boolean;
	},
	required: NormalizedUploadConstraints
) => {
	const normalizedAsset = normalizeUploadConstraints({
		acceptedContentTypes: asset.acceptedContentTypes,
		maxBytes: asset.maxBytes,
		maxDurationSeconds: asset.maxDurationSeconds ?? undefined,
		enableCompression: asset.enableCompression,
		enableSafetyScreening: asset.enableSafetyScreening
	});

	if (required.enableCompression && !normalizedAsset.enableCompression) {
		return false;
	}

	if (required.enableSafetyScreening && !normalizedAsset.enableSafetyScreening) {
		return false;
	}

	if (normalizedAsset.maxBytes > required.maxBytes) {
		return false;
	}

	if (
		required.maxDurationSeconds != null &&
		buildAcceptedMediaKinds(normalizedAsset.acceptedContentTypes).includes('video')
	) {
		if (
			normalizedAsset.maxDurationSeconds == null ||
			normalizedAsset.maxDurationSeconds > required.maxDurationSeconds
		) {
			return false;
		}
	}

	return normalizedAsset.acceptedContentTypes.every((contentType) =>
		required.acceptedContentTypes.includes(contentType)
	);
};

export const getAcceptedFileExtensions = (acceptedContentTypes: readonly SupportedContentType[]) =>
	buildAcceptedFileExtensions(acceptedContentTypes);

export const isVideoFilename = (filename?: string | null) => {
	const extension = getFileExtension(filename);
	return Boolean(
		extension && (VIDEO_EXTENSIONS as readonly string[]).includes(extension)
	);
};

export const buildValidationFailure = (
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

export const buildProcessingFailure = (
	code: string,
	message: string,
	retryable = false
): MediaPipelineFailure => ({
	code,
	message,
	stage: 'processing',
	recoverable: true,
	retryable
});

export const buildRejectedUploadFailure = (
	message = USER_SAFE_REJECTED_UPLOAD_MESSAGE
): MediaPipelineFailure => ({
	code: 'media_rejected',
	message,
	stage: 'processing',
	recoverable: false,
	retryable: false
});
