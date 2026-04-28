import { redirect } from '@sveltejs/kit';
import { routes } from '$lib/routes';
import type { PageServerLoad } from './$types';

const normalizeClubCode = (code: string) => code.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();

export const load: PageServerLoad = async ({ locals, params }) => {
	const code = normalizeClubCode(params.clubcode);
	const basePath = locals.token ? routes.newClubJoin : routes.onboardingJoinClub;

	throw redirect(307, `${basePath}/${code}`);
};
