import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

export const load: PageLoad = ({ params }) => {
	throw redirect(307, `/session/${params.sessionId}/activities`);
};
