import type { PageServerLoad } from './$types';
import { getConvexServerClient } from '$lib/server/convex';
import { api } from '$convex/_generated/api';

export const load: PageServerLoad = async ({ locals }) => {
	const convex = getConvexServerClient(locals.token);
	const document = await convex.query(api.legalDocuments.getActiveByKey, {
		documentKey: 'privacy_policy'
	});

	return {
		document
	};
};
