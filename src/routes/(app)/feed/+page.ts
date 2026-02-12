import { redirect } from '@sveltejs/kit';
import { routes } from '$lib/routes';
import type { PageLoad } from './$types';

export const load: PageLoad = () => {
	throw redirect(307, routes.feedMyClubs);
};
