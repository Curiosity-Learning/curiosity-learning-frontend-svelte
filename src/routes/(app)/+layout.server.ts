import { redirect } from '@sveltejs/kit';
import { api } from '$convex/_generated/api';
import { getConvexServerClient } from '$lib/server/convex';
import { getEstimatedIpLocation } from '$lib/server/ip-location';
import { isNoClubAllowedPath } from '$lib/auth/no-club-allowlist';
import { routes } from '$lib/routes';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, request, url }) => {
	if (!locals.token) {
		const next = `${url.pathname}${url.search}`;
		throw redirect(307, `/auth/sign-in?next=${encodeURIComponent(next)}`);
	}

	if (!isNoClubAllowedPath(url.pathname)) {
		const convex = getConvexServerClient(locals.token);
		// Runs on every SSR load in this layout group — only the count matters here, so the
		// lightweight switcher query (no schedule slots/video URL/profile per club) is enough.
		const clubs = await convex.query(api.clubs.getMyClubSwitcherItems, {});
		if (clubs.length === 0) {
			// Admin-invited leaders (clubLeaderInvites) skip the application flow entirely: their
			// club was drafted by staff and is founded here, on their first club-less arrival, by
			// matching their verified email against a pending invite. The mutation is a fast
			// no_invite for everyone else and club-less users are rare, so running it inside this
			// gate keeps the whole flow to a single choke point.
			const claim = await convex.mutation(api.clubLeaderInvites.claimMyLeaderInvite, {});
			if (claim.status === 'claimed') {
				throw redirect(307, routes.clubHome(claim.clubId));
			}
			throw redirect(307, routes.newClub);
		}
	}

	return {
		estimatedLocation: getEstimatedIpLocation(request.headers)
	};
};
