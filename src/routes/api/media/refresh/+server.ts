import { error, json } from '@sveltejs/kit';
import { api } from '$convex/_generated/api';
import type { Id } from '$convex/_generated/dataModel';
import { getConvexServerClient } from '$lib/server/convex';
import { loadMediaDeliveryConfigOrNull } from '$lib/server/media-delivery';
import {
	getSignedOwnedMediaAssets,
	getSignedProjectMediaAssets
} from '$lib/server/signed-media';
import type { RequestHandler } from './$types';

type RefreshContext =
	| {
			kind: 'owned';
	  }
	| {
			kind: 'project';
			projectId: string;
	  };

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

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
	const assets =
		context.kind === 'owned'
			? await getSignedOwnedMediaAssets(convex, assetIds as Id<'mediaAssets'>[], deliveryConfig)
			: await getSignedProjectMediaAssets(
					convex,
					context.projectId as Id<'projects'>,
					assetIds as Id<'mediaAssets'>[],
					deliveryConfig
				);

	return json({
		assets
	});
};
