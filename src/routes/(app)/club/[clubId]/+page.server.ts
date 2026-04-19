import type { Id } from '$convex/_generated/dataModel';
import { api } from '$convex/_generated/api';
import { getConvexServerClient } from '$lib/server/convex';
import { getSignedClubMemberProfileAssets, getSignedClubProfileAssets } from '$lib/server/signed-media';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	if (!locals.token) {
		return {
			initialLearnerImages: [],
			initialProjectPreviewImages: [],
			initialSessionAttendeeImages: []
		};
	}

	const convex = getConvexServerClient(locals.token);
	const clubId = params.clubId as Id<'clubs'>;
	const [learners, projectPreviews, sessionCards] = await Promise.all([
		convex.query(api.clubs.getMembers, {
			clubId,
			roleName: 'Learner'
		}),
		convex.query(api.projects.listPreviewsByClub, { clubId, limit: 6 }),
		convex.query(api.sessions.listCardPreviewsByClub, {
			clubId,
			upcomingOnly: true,
			limit: 6,
			includeAttendees: true
		})
	]);
	const learnerAssetIds = learners
		.map((learner) => learner.profileImageMediaAssetId)
		.filter((assetId): assetId is Id<'mediaAssets'> => assetId !== null);
	const projectPreviewAssetIds = projectPreviews
		.flatMap((entry) => entry.members.map((member) => member.profileImageMediaAssetId))
		.filter((assetId): assetId is Id<'mediaAssets'> => assetId !== null);
	const sessionAttendeeAssetIds = sessionCards
		.flatMap((entry) => entry.attendees.map((attendee) => attendee.profileImageMediaAssetId))
		.filter((assetId): assetId is Id<'mediaAssets'> => assetId !== null);

	return {
		initialLearnerImages: await getSignedClubMemberProfileAssets(convex, clubId, learnerAssetIds),
		initialProjectPreviewImages: await getSignedClubProfileAssets(
			convex,
			clubId,
			projectPreviewAssetIds
		),
		initialSessionAttendeeImages: await getSignedClubProfileAssets(
			convex,
			clubId,
			sessionAttendeeAssetIds
		)
	};
};
