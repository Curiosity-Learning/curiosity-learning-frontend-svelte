import { error, json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { appleAppSiteAssociation } from '$lib/server/native-app-links';
import type { RequestHandler } from './$types';

// CL-819 spike: must be served with no redirect, as JSON, over https (Apple's CDN fetches it).
export const GET: RequestHandler = () => {
	const body = appleAppSiteAssociation(env.NATIVE_APP_IOS_APP_IDS);
	if (!body) error(404, 'Not found');
	return json(body, { headers: { 'cache-control': 'public, max-age=300' } });
};
