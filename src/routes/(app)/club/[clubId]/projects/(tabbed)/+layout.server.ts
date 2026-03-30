import type { Id } from '$convex/_generated/dataModel';
import { api } from '$convex/_generated/api';
import { getConvexServerClient } from '$lib/server/convex';
import { getSignedClubProfileAssets } from '$lib/server/signed-media';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, params }) => {
	if (!locals.token) {
		return {
			initialProjectPreviewImages: []
		};
	}

	const convex = getConvexServerClient(locals.token);
	const clubId = params.clubId as Id<'clubs'>;
	const projectPreviews = await convex.query(api.projects.listPreviewsByClub, { clubId });
	const assetIds = projectPreviews
		.flatMap((entry) => entry.members.map((member) => member.profileImageMediaAssetId))
		.filter((assetId): assetId is Id<'mediaAssets'> => assetId !== null);

	return {
		initialProjectPreviewImages: await getSignedClubProfileAssets(convex, clubId, assetIds)
	};
};
