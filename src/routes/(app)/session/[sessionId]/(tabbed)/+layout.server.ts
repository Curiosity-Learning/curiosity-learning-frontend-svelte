import type { Id } from '$convex/_generated/dataModel';
import { api } from '$convex/_generated/api';
import { getConvexServerClient } from '$lib/server/convex';
import { getSignedSessionPhotoAssets } from '$lib/server/signed-media';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, params, url }) => {
	if (!locals.token) {
		return {
			initialSessionPhotos: []
		};
	}

	const convex = getConvexServerClient(locals.token);
	const sessionId = params.sessionId as Id<'sessions'>;
	const loadPhotos = url.pathname.endsWith('/photos');
	const photos = loadPhotos ? await convex.query(api.sessions.listPhotos, { sessionId }) : [];
	const photoAssetIds = photos.map((photo) => photo.mediaAssetId);

	return {
		initialSessionPhotos: loadPhotos
			? await getSignedSessionPhotoAssets(convex, sessionId, photoAssetIds)
			: []
	};
};
