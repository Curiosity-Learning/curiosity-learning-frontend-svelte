import type { Id } from '$convex/_generated/dataModel';
import { api } from '$convex/_generated/api';
import { getConvexServerClient } from '$lib/server/convex';
import { getSignedClubMemberProfileAssets } from '$lib/server/signed-media';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	if (!locals.token) {
		return {
			initialLearnerImages: []
		};
	}

	const convex = getConvexServerClient(locals.token);
	const clubId = params.clubId as Id<'clubs'>;
	const learners = await convex.query(api.clubs.getMembers, {
		clubId,
		roleName: 'Learner'
	});
	const learnerAssetIds = learners
		.map((learner) => learner.profileImageMediaAssetId)
		.filter((assetId): assetId is Id<'mediaAssets'> => assetId !== null);

	return {
		initialLearnerImages: await getSignedClubMemberProfileAssets(convex, clubId, learnerAssetIds)
	};
};
