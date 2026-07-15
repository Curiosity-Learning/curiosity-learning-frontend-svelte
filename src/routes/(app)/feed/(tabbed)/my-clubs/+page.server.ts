import type { Id } from '$convex/_generated/dataModel';
import { api } from '$convex/_generated/api';
import { getConvexServerClient } from '$lib/server/convex';
import {
	getSignedViewerUpdateAuthorAssets,
	getSignedViewerUpdateMediaAssets
} from '$lib/server/signed-media';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.token) {
		return {
			initialUpdates: [],
			initialCursor: null,
			initialUpdateAuthorImages: [],
			initialUpdateMedia: []
		};
	}

	const convex = getConvexServerClient(locals.token);
	const page = await convex.query(api.updates.listForViewer, { limit: 20 });
	const authorAssetIds = page.items
		.map((item) => item.authorImageMediaAssetId)
		.filter((assetId): assetId is Id<'mediaAssets'> => assetId !== null);
	const mediaAssetIds = page.items.flatMap((item) => item.mediaAssetIds);

	return {
		initialUpdates: page.items,
		initialCursor: page.nextCursor,
		initialUpdateAuthorImages: await getSignedViewerUpdateAuthorAssets(
			convex,
			authorAssetIds,
			50
		),
		initialUpdateMedia: await getSignedViewerUpdateMediaAssets(convex, mediaAssetIds, 50)
	};
};
