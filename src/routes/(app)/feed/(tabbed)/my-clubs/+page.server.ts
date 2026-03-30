import type { Id } from '$convex/_generated/dataModel';
import { api } from '$convex/_generated/api';
import { getConvexServerClient } from '$lib/server/convex';
import { getSignedViewerUpdateAuthorAssets } from '$lib/server/signed-media';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.token) {
		return {
			initialUpdates: [],
			initialUpdateAuthorImages: []
		};
	}

	const convex = getConvexServerClient(locals.token);
	const initialUpdates = await convex.query(api.updates.listForViewer, { limit: 50 });
	const authorAssetIds = initialUpdates
		.map((item) => item.authorImageMediaAssetId)
		.filter((assetId): assetId is Id<'mediaAssets'> => assetId !== null);

	return {
		initialUpdates,
		initialUpdateAuthorImages: await getSignedViewerUpdateAuthorAssets(
			convex,
			authorAssetIds,
			50
		)
	};
};
