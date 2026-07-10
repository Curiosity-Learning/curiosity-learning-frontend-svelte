import type { Id } from '$convex/_generated/dataModel';
import { api } from '$convex/_generated/api';
import { getConvexServerClient } from '$lib/server/convex';
import {
	getSignedGlobalUpdateAuthorAssets,
	getSignedGlobalUpdateMediaAssets
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
	const page = await convex.query(api.updates.listGlobal, { limit: 20 });
	const updateIds = page.items.map((item) => item.updateId);
	const authorAssetIds = page.items
		.map((item) => item.authorImageMediaAssetId)
		.filter((assetId): assetId is Id<'mediaAssets'> => assetId !== null);
	const mediaAssetIds = page.items.flatMap((item) => item.mediaAssetIds);

	return {
		initialUpdates: page.items,
		initialCursor: page.nextCursor,
		initialUpdateAuthorImages: await getSignedGlobalUpdateAuthorAssets(
			convex,
			updateIds,
			authorAssetIds
		),
		initialUpdateMedia: await getSignedGlobalUpdateMediaAssets(convex, updateIds, mediaAssetIds)
	};
};
