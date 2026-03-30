import type { Id } from '$convex/_generated/dataModel';
import { api } from '$convex/_generated/api';
import { getConvexServerClient } from '$lib/server/convex';
import {
	getSignedProjectMediaAssets,
	getSignedProjectMemberProfileAssets
} from '$lib/server/signed-media';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, params, url }) => {
	if (!locals.token) {
		return {
			initialProjectMemberImages: [],
			initialProjectUpdateMedia: []
		};
	}

	const convex = getConvexServerClient(locals.token);
	const projectId = params.projectId as Id<'projects'>;
	const members = await convex.query(api.projects.listMembers, { projectId });
	const memberAssetIds = members
		.map((member) => member.profileImageMediaAssetId)
		.filter((assetId): assetId is Id<'mediaAssets'> => assetId !== null);
	const loadUpdateMedia = url.pathname.endsWith('/overview');
	const updates = loadUpdateMedia
		? await convex.query(api.updates.listByProject, { projectId })
		: [];
	const updateMediaAssetIds = updates.flatMap((update) => update.mediaAssetIds ?? []);

	return {
		initialProjectMemberImages: await getSignedProjectMemberProfileAssets(
			convex,
			projectId,
			memberAssetIds
		),
		initialProjectUpdateMedia: loadUpdateMedia
			? await getSignedProjectMediaAssets(convex, projectId, updateMediaAssetIds)
			: []
	};
};
