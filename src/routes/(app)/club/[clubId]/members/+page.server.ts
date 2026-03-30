import type { Id } from '$convex/_generated/dataModel';
import { api } from '$convex/_generated/api';
import { getConvexServerClient } from '$lib/server/convex';
import { getSignedClubMemberProfileAssets } from '$lib/server/signed-media';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	if (!locals.token) {
		return {
			initialMemberImages: []
		};
	}

	const convex = getConvexServerClient(locals.token);
	const clubId = params.clubId as Id<'clubs'>;
	const members = await convex.query(api.clubs.getMembers, { clubId });
	const memberAssetIds = members
		.map((member) => member.profileImageMediaAssetId)
		.filter((assetId): assetId is Id<'mediaAssets'> => assetId !== null);

	return {
		initialMemberImages: await getSignedClubMemberProfileAssets(convex, clubId, memberAssetIds)
	};
};
