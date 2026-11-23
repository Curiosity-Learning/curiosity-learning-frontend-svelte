import type { LayoutServerLoad } from './$types';

// hooks.server.ts has already read the Convex JWT cookie into locals.token; a present token is
// what the Svelte adapter's getAuthState() treats as signed in.
export const load: LayoutServerLoad = async ({ locals }) => {
	return {
		authState: { isAuthenticated: Boolean(locals.token) }
	};
};
