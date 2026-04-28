import { api } from '$convex/_generated/api';
import { getConvexServerClient } from '$lib/server/convex';
import { signDeliveryAsset } from '$lib/server/signed-media';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	const convex = getConvexServerClient(locals.token);
	const deliveryAsset = await convex.query(api.clubs.getClubPreviewDeliveryAssetByCode, {
		code: params.code.toUpperCase()
	});

	return {
		isAuthenticated: Boolean(locals.token),
		initialClubVideo: signDeliveryAsset(deliveryAsset)
	};
};
