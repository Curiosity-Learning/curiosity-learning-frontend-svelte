import { getEstimatedIpLocation } from '$lib/server/ip-location';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, request }) => {
	return {
		isAuthenticated: Boolean(locals.token),
		estimatedLocation: getEstimatedIpLocation(request.headers)
	};
};
