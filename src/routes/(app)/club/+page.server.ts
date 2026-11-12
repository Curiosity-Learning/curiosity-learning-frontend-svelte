import { redirect } from '@sveltejs/kit';
import { api } from '$convex/_generated/api';
import { getConvexServerClient } from '$lib/server/convex';
import { routes } from '$lib/routes';
import type { PageServerLoad } from './$types';

// /club (no id) is a shareable "take me to my club" URL: it redirects to the caller's current
// club — profiles.activeClubId when it's still one of their memberships, otherwise their first
// club. Club-less users never reach this load: /club is not on the no-club allowlist, so the
// (app) layout gate has already run the leader-invite claim and bounced them (into their newly
// founded club, or to /new-club).
export const load: PageServerLoad = async ({ locals }) => {
	// The (app) layout redirects signed-out users before this runs; belt-and-braces for direct hits.
	if (!locals.token) {
		throw redirect(307, routes.newClub);
	}

	const convex = getConvexServerClient(locals.token);
	const [clubs, activeContext] = await Promise.all([
		convex.query(api.clubs.getMyClubSwitcherItems, {}),
		convex.query(api.clubs.getActiveClubContext, {})
	]);

	if (clubs.length === 0) {
		throw redirect(307, routes.newClub);
	}

	const activeClubId = activeContext.activeClubId;
	const clubId =
		activeClubId && clubs.some((club) => club.clubId === activeClubId)
			? activeClubId
			: clubs[0].clubId;

	throw redirect(307, routes.clubHome(clubId));
};
