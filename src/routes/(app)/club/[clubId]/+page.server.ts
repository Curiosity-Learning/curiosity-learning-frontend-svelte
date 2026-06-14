import type { Id } from '$convex/_generated/dataModel';
import { api } from '$convex/_generated/api';
import { getConvexServerClient } from '$lib/server/convex';
import {
	getSignedClubMemberProfileAssets,
	getSignedClubProfileAssets
} from '$lib/server/signed-media';
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
	const clubs = await convex.query(api.clubs.getMyClubs, {});
	const club = clubs.find((item) => item.clubId === clubId);

	if (!club) {
		return {
			initialLearnerImages: [],
			initialProjectPreviewImages: [],
			initialSessionAttendeeImages: []
		};
	}

	const permissions = club.rolePermissions;
	const canReadMembers = permissions.includes('club_member:read_active');
	const canReadAttendance = permissions.includes('attendance:read');
	const canReadProjects = permissions.includes('project:read');
	const canReadSessions = permissions.includes('session:read');
	const [learners, projectPreviews, sessionCards] = await Promise.all([
		canReadMembers
			? convex.query(api.clubs.getMembers, {
					clubId,
					roleKey: 'learner'
				})
			: [],
		canReadProjects ? convex.query(api.projects.listPreviewsByClub, { clubId, limit: 6 }) : [],
		canReadSessions
			? convex.query(api.sessions.listCardPreviewsByClub, {
					clubId,
					upcomingOnly: true,
					limit: 6,
					includeAttendees: canReadMembers && canReadAttendance
				})
			: []
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
