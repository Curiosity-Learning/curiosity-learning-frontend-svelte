import type { useConvexClient } from 'convex-svelte';
import { api } from '$convex/_generated/api';
import type { Id } from '$convex/_generated/dataModel';
import { t } from '$lib/i18n';

type UploadConstraints = {
	acceptedContentTypes: string[];
	maxBytes: number;
	enableCompression?: boolean;
	enableSafetyScreening?: boolean;
};

type MediaUploadResult = {
	assetId: Id<'mediaAssets'>;
	status: 'pending_upload' | 'processing' | 'ready' | 'failed' | 'canceled';
};

type ConvexClient = ReturnType<typeof useConvexClient>;

type MediaUploadDescriptor = {
	provider: string;
	method: 'PUT' | 'POST';
	url: string;
	headers?: Record<string, string>;
	fields?: Record<string, string>;
	objectKey: string;
	uploadToken?: string;
};

type MediaBeginUploadResult = {
	asset: {
		assetId: Id<'mediaAssets'>;
	};
	upload: MediaUploadDescriptor;
};

const readLocalMediaDurationSeconds = async (file: File) => {
	if (typeof window === 'undefined' || !file.type.startsWith('video/')) {
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

const uploadToDescriptor = async (file: File, upload: MediaUploadDescriptor) => {
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
			throw new Error(t('mediaUpload.failedBeforeStorage'));
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
		throw new Error(t('mediaUpload.failedBeforeStorage'));
	}
};

export async function uploadMediaAsset(
	convexClient: ConvexClient,
	file: File,
	constraints: UploadConstraints
): Promise<MediaUploadResult> {
	const clientDurationSeconds = await readLocalMediaDurationSeconds(file);
	const { asset, upload } = (await convexClient.action(api.media.beginUpload, {
		constraints,
		originalFilename: file.name,
		clientContentType: file.type || undefined,
		clientSizeBytes: file.size,
		clientDurationSeconds
	})) as MediaBeginUploadResult;

	await uploadToDescriptor(file, upload);

	const finalized = (await convexClient.action(api.media.finalizeUpload, {
		assetId: asset.assetId
	})) as {
		assetId: Id<'mediaAssets'>;
		status: MediaUploadResult['status'];
	};

	return {
		assetId: finalized.assetId,
		status: finalized.status
	};
}
