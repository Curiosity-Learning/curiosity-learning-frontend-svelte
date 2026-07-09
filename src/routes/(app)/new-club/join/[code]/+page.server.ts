import { api } from '$convex/_generated/api';
import { getConvexServerClient } from '$lib/server/convex';
import { signDeliveryAsset } from '$lib/server/signed-media';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	const convex = getConvexServerClient(locals.token);
	const code = params.code.toUpperCase();

	// Damp brute-force code scanning before the client-side preview query fires. Best-effort:
	// the structured result is intentionally ignored here — see the onboarding join-club
	// [code] route for the same pattern and rationale.
	await convex.mutation(api.clubs.checkClubCodeLookupRateLimit, { code });

	const deliveryAsset = await convex.query(api.clubs.getClubPreviewDeliveryAssetByCode, {
		code
	});

	return {
		isAuthenticated: Boolean(locals.token),
		initialClubVideo: signDeliveryAsset(deliveryAsset)
	};
};
