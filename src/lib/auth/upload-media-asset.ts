import { api } from '$convex/_generated/api';
import type { Id } from '$convex/_generated/dataModel';

type UploadConstraints = {
	acceptedContentTypes: string[];
	maxBytes: number;
	enableCompression?: boolean;
	enableSafetyScreening?: boolean;
};

type MediaUploadResult = {
	assetId: Id<'mediaAssets'>;
	storageId: Id<'_storage'> | null;
	status: 'pending_upload' | 'processing' | 'ready' | 'failed' | 'canceled';
	fileUrl: string | null;
};

export async function uploadMediaAsset(
	convexClient: { mutation: (...args: any[]) => Promise<any> },
	file: File,
	constraints: UploadConstraints
): Promise<MediaUploadResult> {
	const { asset, uploadUrl } = await convexClient.mutation(api.media.beginUpload, {
		constraints,
		originalFilename: file.name,
		clientContentType: file.type || undefined,
		clientSizeBytes: file.size
	});

	const uploadResponse = await fetch(uploadUrl, {
		method: 'POST',
		headers: file.type ? { 'Content-Type': file.type } : undefined,
		body: file
	});
	if (!uploadResponse.ok) {
		throw new Error('Upload failed before the file reached storage.');
	}

	const uploadResult = (await uploadResponse.json()) as {
		storageId?: Id<'_storage'>;
	};
	if (!uploadResult.storageId) {
		throw new Error('Upload completed, but no storage reference was returned.');
	}

	const finalized = await convexClient.mutation(api.media.finalizeUpload, {
		assetId: asset.assetId,
		storageId: uploadResult.storageId
	});

	return {
		assetId: finalized.assetId,
		storageId: finalized.storageId,
		status: finalized.status,
		fileUrl: finalized.fileUrl
	};
}
