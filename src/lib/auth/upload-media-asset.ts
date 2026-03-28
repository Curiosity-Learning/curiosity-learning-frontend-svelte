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
	storageId: Id<'_storage'> | null;
	status: 'pending_upload' | 'processing' | 'ready' | 'failed' | 'canceled';
	fileUrl: string | null;
};

type ConvexClient = ReturnType<typeof useConvexClient>;

export async function uploadMediaAsset(
	convexClient: ConvexClient,
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
		throw new Error(t('mediaUpload.failedBeforeStorage'));
	}

	const uploadResult = (await uploadResponse.json()) as {
		storageId?: Id<'_storage'>;
	};
	if (!uploadResult.storageId) {
		throw new Error(t('mediaUpload.missingStorageReference'));
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
