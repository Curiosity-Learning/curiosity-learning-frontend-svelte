import type { PageLoad } from './$types';

export const load: PageLoad = ({ params }) => {
	return {
		formId: params.formId,
		clubId: params.clubId
	};
};
