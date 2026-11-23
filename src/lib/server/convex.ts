import { createConvexHttpClient } from '@mmailaender/convex-better-auth-svelte/sveltekit';
import { PUBLIC_CONVEX_URL } from '$env/static/public';

// The Svelte adapter (0.10+) reads no env vars itself: pass the deployment URL explicitly.
export const getConvexServerClient = (token?: string) => {
	return createConvexHttpClient({ token, convexUrl: PUBLIC_CONVEX_URL });
};
