import { error, json } from '@sveltejs/kit';
import type { Id } from '$convex/_generated/dataModel';
import { getConvexServerClient } from '$lib/server/convex';
import { loadMediaDeliveryConfigOrNull } from '$lib/server/media-delivery';
import { getSignedClubVideoAsset } from '$lib/server/signed-media';
import type { RequestHandler } from './$types';

// CL-817: signs the intro video for a join-by-code club preview. Anonymous joiners need it
// too, so no sign-in is required. It takes the asset id returned by the rate-limited
// lookupClubByCode, never a club code, so it can't be used to guess codes.
export const POST: RequestHandler = async ({ locals, request }) => {
	const deliveryConfig = loadMediaDeliveryConfigOrNull();
	if (!deliveryConfig) {
		return json({ asset: null });
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Request body must be valid JSON.');
	}

	const assetId =
		typeof body === 'object' && body !== null && 'assetId' in body ? body.assetId : null;
	if (typeof assetId !== 'string' || !assetId.trim()) {
		throw error(400, 'Request body must include assetId.');
	}

	const convex = getConvexServerClient(locals.token);
	try {
		const asset = await getSignedClubVideoAsset(
			convex,
			assetId as Id<'mediaAssets'>,
			deliveryConfig
		);
		return json({ asset });
	} catch {
		// A malformed id fails argument validation; treat it like an unknown video.
		return json({ asset: null });
	}
};
