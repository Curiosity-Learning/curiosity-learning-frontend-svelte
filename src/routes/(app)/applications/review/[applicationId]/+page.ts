import type { Id } from '$convex/_generated/dataModel';
import type { PageLoad } from './$types';

export const load: PageLoad = ({ params }) => {
	return {
		applicationId: params.applicationId as Id<'clubApplications'>
	};
};
