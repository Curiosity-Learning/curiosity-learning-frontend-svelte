import { createConvexHttpClient } from '@mmailaender/convex-better-auth-svelte/sveltekit';

export const getConvexServerClient = (token?: string) => {
	return createConvexHttpClient({ token });
};
