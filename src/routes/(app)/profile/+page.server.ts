import { api } from '$convex/_generated/api';
import { getConvexServerClient } from '$lib/server/convex';
import {
	getSignedOwnedMediaAsset,
	getSignedViewerUpdateMediaAssets
} from '$lib/server/signed-media';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.token) {
		return {
			initialProfileImage: null,
			initialUpdateMedia: []
		};
	}

	const convex = getConvexServerClient(locals.token);
	const profile = await convex.query(api.profiles.getMe, {});
	const updates = await convex.query(api.updates.listMine, {});
	const mediaAssetIds = updates.flatMap((item) => item.mediaAssetIds);

	return {
		initialProfileImage: profile.profileImageMediaAssetId
			? await getSignedOwnedMediaAsset(convex, profile.profileImageMediaAssetId)
			: null,
		initialUpdateMedia: await getSignedViewerUpdateMediaAssets(convex, mediaAssetIds, 100)
	};
};
