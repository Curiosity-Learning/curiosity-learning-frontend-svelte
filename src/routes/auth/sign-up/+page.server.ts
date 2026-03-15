import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	return {
		googleOAuthEnabled: Boolean(
			process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
		)
	};
};
