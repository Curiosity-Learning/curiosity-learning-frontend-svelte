import type { Id } from '$convex/_generated/dataModel';
import { api } from '$convex/_generated/api';
import { getConvexServerClient } from '$lib/server/convex';
import { getSignedClubProfileAssets } from '$lib/server/signed-media';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	if (!locals.token) {
		return {
			initialSessionAttendeeImages: []
		};
	}

	const convex = getConvexServerClient(locals.token);
	const clubId = params.clubId as Id<'clubs'>;
	// Mirror the client-side sessions page query (includeCancelled) so every attendee avatar
	// that can render there has a signed URL prepared here.
	const sessionCards = await convex.query(api.sessions.listCardPreviewsByClub, {
		clubId,
		upcomingOnly: false,
		includeAttendees: true,
		includeCancelled: true
	});
	const assetIds = sessionCards
		.flatMap((entry) => entry.attendees.map((attendee) => attendee.profileImageMediaAssetId))
		.filter((assetId): assetId is Id<'mediaAssets'> => assetId !== null);

	return {
		initialSessionAttendeeImages: await getSignedClubProfileAssets(convex, clubId, assetIds)
	};
};
