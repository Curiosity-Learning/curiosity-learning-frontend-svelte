import { createSvelteKitHandler } from '@mmailaender/convex-better-auth-svelte/sveltekit';
import type { RequestHandler } from './$types';

const handler = createSvelteKitHandler();

const isAbortError = (error: unknown) =>
	error instanceof DOMException
		? error.name === 'AbortError'
		: error instanceof Error && error.name === 'AbortError';

const wrapHandler = (requestHandler: RequestHandler): RequestHandler => {
	return async (event) => {
		try {
			return await requestHandler(event);
		} catch (error) {
			if (isAbortError(error)) {
				return new Response(null, { status: 204 });
			}
			throw error;
		}
	};
};

export const GET = wrapHandler(handler.GET);
export const POST = wrapHandler(handler.POST);
