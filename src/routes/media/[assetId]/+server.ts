import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { api } from '$convex/_generated/api';
import type { Id } from '$convex/_generated/dataModel';
import { getConvexServerClient } from '$lib/server/convex';
import {
	buildMediaCdnUrl,
	createCloudFrontSignedCookies,
	loadMediaDeliveryConfigOrNull
} from '$lib/server/media-delivery';

const buildRedirect = (location: string) =>
	new Response(null, {
		status: 307,
		headers: {
			location,
			'cache-control': 'private, no-store'
		}
	});

export const GET: RequestHandler = async ({ cookies, locals, params }) => {
	if (!locals.token) {
		throw error(401, 'Authentication required');
	}

	const convex = getConvexServerClient(locals.token);

	try {
		const asset = await convex.query(api.media.getDeliveryAsset, {
			assetId: params.assetId as Id<'mediaAssets'>
		});

		if (asset.status !== 'ready') {
			throw error(409, 'Media asset is not ready');
		}

		const deliveryConfig = loadMediaDeliveryConfigOrNull();
		if (deliveryConfig) {
			if (!asset.deliveryObjectKey) {
				throw error(503, 'Media delivery object could not be resolved for this asset');
			}

			const { cookieValues, expiresAt } = createCloudFrontSignedCookies(deliveryConfig);
			for (const cookieValue of cookieValues) {
				cookies.set(cookieValue.name, cookieValue.value, {
					domain: deliveryConfig.cookieDomain,
					path: '/',
					expires: new Date(expiresAt * 1000),
					httpOnly: true,
					sameSite: 'lax',
					secure: true
				});
			}

			return buildRedirect(
				buildMediaCdnUrl({
					baseUrl: deliveryConfig.baseUrl,
					objectKey: asset.deliveryObjectKey
				})
			);
		}

		if (!asset.fallbackFileUrl) {
			throw error(
				503,
				'Media delivery is not configured for this asset. Configure CloudFront delivery or a readable media base URL before using the app media route.'
			);
		}

		// Transitional fallback for development while secure delivery infra is still being configured.
		return buildRedirect(asset.fallbackFileUrl);
	} catch (caught) {
		const message = caught instanceof Error ? caught.message : 'Failed to load media asset';

		if (message.includes('Upload not found')) {
			throw error(404, 'Media asset not found');
		}

		if (message.includes('Permission denied')) {
			throw error(403, 'You do not have access to this media asset');
		}

		if (message.includes('Unauthenticated')) {
			throw error(401, 'Authentication required');
		}

		if (message.includes('Secure media delivery is partially configured')) {
			throw error(503, message);
		}

		throw caught;
	}
};
