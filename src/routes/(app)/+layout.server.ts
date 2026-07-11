import { redirect } from '@sveltejs/kit';
import { api } from '$convex/_generated/api';
import { getConvexServerClient } from '$lib/server/convex';
import { getEstimatedIpLocation } from '$lib/server/ip-location';
import { routes } from '$lib/routes';
import type { LayoutServerLoad } from './$types';

// PRD 2.4/6.1.10 (CL-703): a club-less parent must still be able to reach Settings (to see their
// linked children) and /child (the read-only "View as Child" surface) — see CL-690's original
// no-club allowlist that this extends.
const noClubAllowedPaths = [
	routes.noClub,
	routes.newClub,
	routes.profile,
	routes.settings,
	routes.notifications,
	routes.child
];

const isNoClubAllowedPath = (pathname: string) =>
	noClubAllowedPaths.some(
		(allowedPath) => pathname === allowedPath || pathname.startsWith(`${allowedPath}/`)
	);

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
			throw redirect(307, routes.newClub);
		}
	}

	return {
		estimatedLocation: getEstimatedIpLocation(request.headers)
	};
};
