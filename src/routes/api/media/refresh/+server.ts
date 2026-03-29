import { error, json } from '@sveltejs/kit';
import { api } from '$convex/_generated/api';
import type { Id } from '$convex/_generated/dataModel';
import { getConvexServerClient } from '$lib/server/convex';
import {
	createCloudFrontSignedUrl,
	loadMediaDeliveryConfigOrNull
} from '$lib/server/media-delivery';
import type { RequestHandler } from './$types';

type RefreshContext =
	| {
			kind: 'owned';
	  }
	| {
			kind: 'project';
			projectId: string;
	  };

type DeliveryAsset = {
	assetId: Id<'mediaAssets'>;
	storageProvider: 's3';
	deliveryBucket: string | null;
	deliveryObjectKey: string | null;
	mediaKind: 'image' | 'video' | null;
	contentType: string | null;
	durationSeconds: number | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

const hasDeliveryObjectKey = (asset: DeliveryAsset | null): asset is DeliveryAsset & { deliveryObjectKey: string } =>
	Boolean(asset?.deliveryObjectKey);

const parseContext = (value: unknown): RefreshContext | null => {
	if (!isRecord(value) || typeof value.kind !== 'string') {
		return null;
	}

	if (value.kind === 'owned') {
		return { kind: 'owned' };
	}

	if (value.kind === 'project' && typeof value.projectId === 'string' && value.projectId.trim()) {
		return {
			kind: 'project',
			projectId: value.projectId
		};
	}

	return null;
};

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.token) {
		throw error(401, 'Authentication required');
	}

	const deliveryConfig = loadMediaDeliveryConfigOrNull();
	if (!deliveryConfig) {
		throw error(503, 'Secure media delivery is not configured.');
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Request body must be valid JSON.');
	}

	if (!isRecord(body) || !Array.isArray(body.assetIds)) {
		throw error(400, 'Request body must include assetIds.');
	}

	const context = parseContext(body.context);
	if (!context) {
		throw error(400, 'Request body must include a valid media refresh context.');
	}

	const assetIds = [...new Set(body.assetIds.filter((value): value is string => typeof value === 'string'))];
	if (!assetIds.length) {
		return json({ assets: [] });
	}

	const convex = getConvexServerClient(locals.token);
	const deliveryAssets =
		context.kind === 'owned'
			? await convex.query(api.media.getOwnedDeliveryAssets, {
					assetIds: assetIds as Id<'mediaAssets'>[]
				})
			: await convex.query(api.updates.getProjectDeliveryAssets, {
					projectId: context.projectId as Id<'projects'>,
					assetIds: assetIds as Id<'mediaAssets'>[]
				});

	return json({
		assets: deliveryAssets
			.filter(hasDeliveryObjectKey)
			.map((asset) => {
				const delivery = createCloudFrontSignedUrl(deliveryConfig, {
					objectKey: asset.deliveryObjectKey,
					mediaKind: asset.mediaKind,
					contentType: asset.contentType,
					durationSeconds: asset.durationSeconds
				});

				return {
					assetId: asset.assetId,
					mediaKind: asset.mediaKind,
					contentType: asset.contentType,
					durationSeconds: asset.durationSeconds,
					signedUrl: delivery.signedUrl,
					expiresAt: delivery.expiresAt
				};
			})
	});
};
