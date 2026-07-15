import type { Id } from '$convex/_generated/dataModel';
import type { PageLoad } from './$types';

export const load: PageLoad = ({ params }) => {
	return {
		clubId: params.clubId as Id<'clubs'>
	};
};
