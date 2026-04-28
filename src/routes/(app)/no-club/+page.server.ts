import { redirect } from '@sveltejs/kit';
import { routes } from '$lib/routes';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	throw redirect(308, routes.newClub);
};
