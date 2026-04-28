import type { PageLoad } from './$types';

export const load: PageLoad = ({ data, params }) => {
	return {
		...data,
		code: params.code.toUpperCase()
	};
};
