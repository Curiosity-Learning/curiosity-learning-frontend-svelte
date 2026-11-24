import { error, json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { androidAssetLinks } from '$lib/server/native-app-links';
import type { RequestHandler } from './$types';

// CL-819 spike: Android App Links verification file.
export const GET: RequestHandler = () => {
	const body = androidAssetLinks(env.NATIVE_APP_ANDROID_SHA256);
	if (!body) error(404, 'Not found');
	return json(body, { headers: { 'cache-control': 'public, max-age=300' } });
};
