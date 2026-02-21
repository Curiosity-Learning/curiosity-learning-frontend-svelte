import { getAuthState } from '@mmailaender/convex-better-auth-svelte/sveltekit';
import { createAuth } from '$convex/auth';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ cookies }) => {
	return {
		authState: await getAuthState(createAuth, cookies)
	};
};
