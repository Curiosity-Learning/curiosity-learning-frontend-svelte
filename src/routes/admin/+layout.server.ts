import { error, redirect } from '@sveltejs/kit';
import { ConvexError } from 'convex/values';
import { api } from '$convex/_generated/api';
import { getConvexServerClient } from '$lib/server/convex';
import type { LayoutServerLoad } from './$types';

// CL-693: separate route group, separate gate from (app)'s +layout.server.ts. Two checks:
// 1. Authenticated session required at all (same as (app)) — redirect to sign-in.
// 2. Global admin role required — render a plain 404 for authenticated non-admins so the
//    existence of /admin is never advertised to regular members. Server-side enforcement here
//    is a UX nicety only; every admin query/mutation must independently call requireGlobalAdmin.
export const load: LayoutServerLoad = async ({ locals, url }) => {
	if (!locals.token) {
		const next = `${url.pathname}${url.search}`;
		throw redirect(307, `/auth/sign-in?next=${encodeURIComponent(next)}`);
	}

	const convex = getConvexServerClient(locals.token);
	let globalRole: 'admin' | null = null;
	try {
		globalRole = await convex.query(api.profiles.getMyGlobalRole, {});
	} catch (err) {
		if (err instanceof ConvexError) {
			throw error(404, 'Not found');
		}
		throw err;
	}

	if (globalRole !== 'admin') {
		throw error(404, 'Not found');
	}

	return {};
};
