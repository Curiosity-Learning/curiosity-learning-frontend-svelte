import { error, redirect } from '@sveltejs/kit';
import { ConvexError } from 'convex/values';
import { api } from '$convex/_generated/api';
import type { Id } from '$convex/_generated/dataModel';
import { getConvexServerClient } from '$lib/server/convex';
import {
	getSignedGlobalUpdateMediaAssets,
	getSignedProfileAssets,
	getSignedProjectCoverAssets
} from '$lib/server/signed-media';
import { routes } from '$lib/routes';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	if (!locals.token) {
		return {
			profile: null,
			initialProfileImage: null,
			initialProjectCovers: []
		};
	}

	const convex = getConvexServerClient(locals.token);
	const profileId = params.profileId as Id<'profiles'>;

	let profile;
	try {
		profile = await convex.query(api.profiles.getById, { profileId });
	} catch (err) {
		if (err instanceof ConvexError) {
			throw error(404, 'Profile not found');
		}
		throw err;
	}

	// Own-profile visits redirect to /profile — no need to render the "other user" chrome for
	// yourself, and it keeps the two pages' data-fetching concerns cleanly split.
	if (profile.isSelf) {
		throw redirect(307, routes.profile);
	}

	const projectIds = [...profile.projects.current, ...profile.projects.showcase].map(
		(project) => project.projectId
	);
	const updateIds = profile.updates.map((update) => update.updateId);
	const updateMediaAssetIds = profile.updates.flatMap((update) => update.mediaAssetIds);

	return {
		profile,
		initialProfileImage: profile.profileImageMediaAssetId
			? (await getSignedProfileAssets(convex, profileId, [profile.profileImageMediaAssetId]))[0] ??
				null
			: null,
		initialProjectCovers: await getSignedProjectCoverAssets(convex, projectIds),
		initialUpdateMedia: await getSignedGlobalUpdateMediaAssets(convex, updateIds, updateMediaAssetIds)
	};
};
