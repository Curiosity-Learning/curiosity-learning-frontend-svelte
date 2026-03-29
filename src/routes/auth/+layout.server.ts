import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

const normalizeRedirectTarget = (nextPath: string | null) => {
	if (!nextPath || !nextPath.startsWith('/')) return '/';
	if (nextPath.startsWith('/auth/')) return '/';
	if (nextPath === '/onboarding/get-started') return '/';
	return nextPath;
};

export const load: LayoutServerLoad = async ({ locals, url }) => {
	if (url.pathname === '/auth/sign-up') {
		return {};
	}

	if (locals.token) {
		throw redirect(307, normalizeRedirectTarget(url.searchParams.get('next')));
	}

	return {};
};
