import { api } from '$convex/_generated/api';
import { getConvexServerClient } from '$lib/server/convex';
import { getSignedOwnedMediaAsset } from '$lib/server/signed-media';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.token) {
		return {
			initialProfileImage: null
		};
	}

	const convex = getConvexServerClient(locals.token);
	const profile = await convex.query(api.profiles.getMe, {});

	return {
		initialProfileImage: profile.profileImageMediaAssetId
			? await getSignedOwnedMediaAsset(convex, profile.profileImageMediaAssetId)
			: null
	};
};
