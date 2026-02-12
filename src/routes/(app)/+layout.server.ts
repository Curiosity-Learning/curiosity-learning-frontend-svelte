import { error as httpError, redirect } from '@sveltejs/kit';
import { api } from '$convex/_generated/api';
import { getConvexServerClient } from '$lib/server/convex';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, url }) => {
	if (!locals.token) {
		const next = `${url.pathname}${url.search}`;
		throw redirect(307, `/auth/sign-in?next=${encodeURIComponent(next)}`);
	}

	const client = getConvexServerClient(locals.token);
	try {
		await client.mutation(api.auth.ensureProfile, {});
	} catch (error) {
		const message = error instanceof Error ? error.message : '';
		if (message.includes('Unauthenticated')) {
			const next = `${url.pathname}${url.search}`;
			throw redirect(307, `/auth/sign-in?next=${encodeURIComponent(next)}`);
		}
		throw httpError(500, 'Unable to initialize account state.');
	}

	return {};
};
