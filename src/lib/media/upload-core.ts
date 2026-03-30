import { browser } from '$app/environment';
import { api } from '$convex/_generated/api';
import type { Id } from '$convex/_generated/dataModel';
import type { ConvexClient } from 'convex/browser';
import type { FunctionReturnType } from 'convex/server';

const mb = (value: number) => value * 1024 * 1024;

export const IMAGE_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
export const VIDEO_CONTENT_TYPES = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v'];

export const mediaUploadPresets = {
	images: {
		label: 'Images',
		acceptedContentTypes: IMAGE_CONTENT_TYPES,
		maxBytesMb: 20
	},
	videos: {
		label: 'Videos',
		acceptedContentTypes: VIDEO_CONTENT_TYPES,
		maxBytesMb: 250
	},
	mixed: {
		label: 'Mixed media',
		acceptedContentTypes: [...IMAGE_CONTENT_TYPES, ...VIDEO_CONTENT_TYPES],
		maxBytesMb: 250
	}
} as const;

export type MediaUploadPreset = keyof typeof mediaUploadPresets;

export type MediaUploadConstraintsInput = {
	acceptedContentTypes: string[];
	maxBytes: number;
	enableCompression?: boolean;
	enableSafetyScreening?: boolean;
};

export type MediaUploadConstraints = {
	acceptedContentTypes: string[];
	maxBytes: number;
	enableCompression: boolean;
	enableSafetyScreening: boolean;
};

export type MediaUploadUiConstraints = MediaUploadConstraints & {
	accept: string;
};

export type MediaUploadDescriptor = {
	provider: string;
	method: 'PUT' | 'POST';
	url: string;
	headers?: Record<string, string>;
	fields?: Record<string, string>;
	objectKey: string;
	uploadToken?: string;
};

export type ResolvedMediaAsset = FunctionReturnType<typeof api.media.getUpload>;

export type MediaBeginUploadResult = {
	asset: ResolvedMediaAsset;
	upload: MediaUploadDescriptor;
};

export class MediaAssetLifecycleError extends Error {
	readonly asset: ResolvedMediaAsset | null;

	constructor(message: string, asset: ResolvedMediaAsset | null) {
		super(message);
		this.name = 'MediaAssetLifecycleError';
		this.asset = asset;
	}
}

const normalizeAcceptedContentTypes = (acceptedContentTypes: string[]) =>
	[...new Set(acceptedContentTypes.map((entry) => entry.trim().toLowerCase()).filter(Boolean))];

export const describeMediaUploadConstraints = (
	input: MediaUploadConstraintsInput
): MediaUploadUiConstraints => {
	const acceptedContentTypes = normalizeAcceptedContentTypes(input.acceptedContentTypes);

	return {
		acceptedContentTypes,
		maxBytes: Math.max(1, Math.floor(Number(input.maxBytes) || 1)),
		enableCompression: input.enableCompression ?? false,
		enableSafetyScreening: input.enableSafetyScreening ?? false,
		accept: acceptedContentTypes.join(',')
	};
};

export const toMediaUploadRequestConstraints = (
	constraints: MediaUploadUiConstraints
): MediaUploadConstraints => ({
	acceptedContentTypes: [...constraints.acceptedContentTypes],
	maxBytes: constraints.maxBytes,
	enableCompression: constraints.enableCompression,
	enableSafetyScreening: constraints.enableSafetyScreening
});

export const createMediaUploadConstraintsFromPreset = (
	preset: MediaUploadPreset,
	options?: {
		enableCompression?: boolean;
		enableSafetyScreening?: boolean;
	}
) =>
	describeMediaUploadConstraints({
		acceptedContentTypes: [...mediaUploadPresets[preset].acceptedContentTypes],
		maxBytes: mb(mediaUploadPresets[preset].maxBytesMb),
		enableCompression: options?.enableCompression ?? false,
		enableSafetyScreening: options?.enableSafetyScreening ?? false
	});

const compactWhitespace = (value: string) => value.replace(/\s+/g, ' ').trim();

const truncate = (value: string, maxLength = 240) =>
	value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;

const buildUploadFailureMessage = async (response: Response) => {
	const suffix = response.statusText ? ` ${response.statusText}` : '';
	const rawBody = compactWhitespace(await response.text());
	const xmlCode = rawBody.match(/<Code>([^<]+)<\/Code>/)?.[1];
	const xmlMessage = rawBody.match(/<Message>([^<]+)<\/Message>/)?.[1];
	const xmlRequestId = rawBody.match(/<RequestId>([^<]+)<\/RequestId>/)?.[1];
	const detail =
		[xmlCode, xmlMessage, xmlRequestId ? `RequestId ${xmlRequestId}` : null]
			.filter(Boolean)
			.join(' | ') || truncate(rawBody);

	return detail
		? `Upload failed (${response.status}${suffix}): ${detail}`
		: `Upload failed (${response.status}${suffix})`;
};

export const normalizeUploadErrorMessage = (error: unknown) => {
	if (error instanceof Error) {
		if (error instanceof TypeError) {
			return `${error.message}. The browser did not get a usable S3 response. Check bucket CORS, the presigned URL region, and network access to S3.`;
		}

		return error.message;
	}

	return 'Upload failed.';
};

export const getLocalPreviewKind = (file: File): 'image' | 'video' | undefined => {
	if (file.type.startsWith('image/')) return 'image';
	if (file.type.startsWith('video/')) return 'video';
	return undefined;
};

export const createLocalPreviewUrl = (file: File) => {
	if (!browser) return undefined;
	const previewKind = getLocalPreviewKind(file);
	if (!previewKind) return undefined;
	return URL.createObjectURL(file);
};

export const revokePreviewUrl = (previewUrl?: string | null) => {
	if (!browser || !previewUrl) return;
	URL.revokeObjectURL(previewUrl);
};

export const readLocalMediaDurationSeconds = async (file: File) => {
	if (!browser || !file.type.startsWith('video/')) {
		return undefined;
	}

	const objectUrl = URL.createObjectURL(file);

	try {
		return await new Promise<number | undefined>((resolve) => {
			const video = document.createElement('video');
			video.preload = 'metadata';

			const cleanup = () => {
				video.removeAttribute('src');
				video.load();
				URL.revokeObjectURL(objectUrl);
			};

			video.onloadedmetadata = () => {
				const duration = Number(video.duration);
				cleanup();
				resolve(Number.isFinite(duration) && duration > 0 ? duration : undefined);
			};

			video.onerror = () => {
				cleanup();
				resolve(undefined);
			};

			video.src = objectUrl;
		});
	} catch {
		URL.revokeObjectURL(objectUrl);
		return undefined;
	}
};

export const uploadFileToDescriptor = async (file: File, upload: MediaUploadDescriptor) => {
	if (upload.method === 'POST') {
		const formData = new FormData();
		for (const [key, value] of Object.entries(upload.fields ?? {})) {
			formData.append(key, value);
		}
		formData.append('file', file);

		const response = await fetch(upload.url, {
			method: 'POST',
			body: formData
		});

		if (!response.ok) {
			throw new Error(await buildUploadFailureMessage(response));
		}

		return;
	}

	const response = await fetch(upload.url, {
		method: upload.method,
		headers: {
			...(upload.headers ?? {}),
			...(!upload.headers?.['content-type'] && file.type ? { 'content-type': file.type } : {})
		},
		body: file
	});

	if (!response.ok) {
		throw new Error(await buildUploadFailureMessage(response));
	}
};

export const beginMediaUpload = async (
	convexClient: ConvexClient,
	file: File,
	constraints: MediaUploadConstraintsInput
) => {
	const normalizedConstraints = describeMediaUploadConstraints(constraints);
	const clientDurationSeconds = await readLocalMediaDurationSeconds(file);
	return (await convexClient.action(api.media.beginUpload, {
		constraints: toMediaUploadRequestConstraints(normalizedConstraints),
		originalFilename: file.name,
		clientContentType: file.type || undefined,
		clientSizeBytes: file.size,
		clientDurationSeconds
	})) as MediaBeginUploadResult;
};

export const finalizeMediaUpload = async (convexClient: ConvexClient, assetId: Id<'mediaAssets'>) =>
	(await convexClient.action(api.media.finalizeUpload, { assetId })) as ResolvedMediaAsset;

export const getMediaUpload = async (convexClient: ConvexClient, assetId: Id<'mediaAssets'>) =>
	(await convexClient.query(api.media.getUpload, { assetId })) as ResolvedMediaAsset;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const waitForMediaUploadReady = async (
	convexClient: ConvexClient,
	assetId: Id<'mediaAssets'>,
	options?: {
		timeoutMs?: number;
		intervalMs?: number;
	}
) => {
	const timeoutMs = options?.timeoutMs ?? 15000;
	const intervalMs = options?.intervalMs ?? 500;
	const startedAt = Date.now();
	let lastAsset: ResolvedMediaAsset | null = null;

	while (Date.now() - startedAt < timeoutMs) {
		const asset = await getMediaUpload(convexClient, assetId);
		lastAsset = asset;

		if (asset.status === 'ready') {
			return asset;
		}

		if (asset.status === 'failed') {
			throw new MediaAssetLifecycleError(asset.lastFailure?.message ?? 'Media processing failed.', asset);
		}

		if (asset.status === 'canceled') {
			throw new MediaAssetLifecycleError('Media upload was canceled.', asset);
		}

		await delay(intervalMs);
	}

	throw new MediaAssetLifecycleError(
		'Media processing timed out before the asset became ready.',
		lastAsset
	);
};

export const cancelMediaUpload = async (
	convexClient: ConvexClient,
	assetId: Id<'mediaAssets'>,
	options?: {
		deleteStorage?: boolean;
	}
) =>
	(await convexClient.action(api.media.cancelUpload, {
		assetId,
		deleteStorage: options?.deleteStorage
	})) as ResolvedMediaAsset;

export const deleteMediaUpload = async (convexClient: ConvexClient, assetId: Id<'mediaAssets'>) =>
	(await convexClient.action(api.media.deleteUpload, {
		assetId
	})) as { assetId: Id<'mediaAssets'>; deleted: true };
