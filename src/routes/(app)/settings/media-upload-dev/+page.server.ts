import { api } from '$convex/_generated/api';
import type { Id } from '$convex/_generated/dataModel';
import { getConvexServerClient } from '$lib/server/convex';
import { getSignedOwnedMediaAsset } from '$lib/server/signed-media';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.token) {
		return {
			selectedAssetId: null,
			selectedDelivery: null
		};
	}

	const convex = getConvexServerClient(locals.token);
	const uploads = await convex.query(api.media.listMyUploads, {});
	const requestedAssetId = url.searchParams.get('selected');
	const selectedAssetId =
		(requestedAssetId &&
			uploads.some((upload) => upload.assetId === requestedAssetId) &&
			(requestedAssetId as Id<'mediaAssets'>)) ||
		(uploads[0]?.assetId ?? null);

	return {
		selectedAssetId,
		selectedDelivery: selectedAssetId
			? await getSignedOwnedMediaAsset(convex, selectedAssetId)
			: null
	};
};
