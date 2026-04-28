import { redirect } from '@sveltejs/kit';
import { api } from '$convex/_generated/api';
import { getConvexServerClient } from '$lib/server/convex';
import { routes } from '$lib/routes';
import type { LayoutServerLoad } from './$types';

const noClubAllowedPaths = [
	routes.noClub,
	routes.newClub,
	routes.chat,
	routes.profile,
	routes.settings,
	routes.notifications
];

const isNoClubAllowedPath = (pathname: string) =>
	noClubAllowedPaths.some(
		(allowedPath) => pathname === allowedPath || pathname.startsWith(`${allowedPath}/`)
	);

export const load: LayoutServerLoad = async ({ locals, url }) => {
	if (!locals.token) {
		const next = `${url.pathname}${url.search}`;
		throw redirect(307, `/auth/sign-in?next=${encodeURIComponent(next)}`);
	}

	if (!isNoClubAllowedPath(url.pathname)) {
		const convex = getConvexServerClient(locals.token);
		const clubs = await convex.query(api.clubs.getMyClubs, {});
		if (clubs.length === 0) {
			throw redirect(307, routes.newClub);
		}
	}

	return {};
};
