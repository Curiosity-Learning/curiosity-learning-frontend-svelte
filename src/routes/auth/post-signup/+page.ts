import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

export const load: PageLoad = ({ url }) => {
	const query = url.searchParams.toString();
	const target = query.length > 0 ? `/onboarding/post-signup?${query}` : '/onboarding/post-signup';
	throw redirect(307, target);
};
