import type { Id } from '$convex/_generated/dataModel';
import { api } from '$convex/_generated/api';
import { getConvexServerClient } from '$lib/server/convex';
import { getSignedProjectMemberProfileAssets } from '$lib/server/signed-media';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, params }) => {
	if (!locals.token) {
		return {
			initialProjectMemberImages: []
		};
	}

	const convex = getConvexServerClient(locals.token);
	const projectId = params.projectId as Id<'projects'>;
	const members = await convex.query(api.projects.listMembers, { projectId });
	const memberAssetIds = members
		.map((member) => member.profileImageMediaAssetId)
		.filter((assetId): assetId is Id<'mediaAssets'> => assetId !== null);

	return {
		initialProjectMemberImages: await getSignedProjectMemberProfileAssets(
			convex,
			projectId,
			memberAssetIds
		)
	};
};
