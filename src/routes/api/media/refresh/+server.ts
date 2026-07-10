import { error, json } from '@sveltejs/kit';
import type { Id } from '$convex/_generated/dataModel';
import { getConvexServerClient } from '$lib/server/convex';
import { loadMediaDeliveryConfigOrNull } from '$lib/server/media-delivery';
import {
	getSignedGlobalUpdateAuthorAssets,
	getSignedGlobalUpdateMediaAssets,
	getSignedOwnedMediaAssets,
	getSignedProjectMediaAssets,
	getSignedViewerUpdateAuthorAssets,
	getSignedViewerUpdateMediaAssets
} from '$lib/server/signed-media';
import type { RequestHandler } from './$types';

type RefreshContext =
	| {
			kind: 'owned';
	  }
	| {
			kind: 'project';
			projectId: string;
	  }
	// CL-727: signing follow-up "load more" pages of the My Clubs feed (club-attribution scoped).
	| {
			kind: 'my-clubs-feed';
	  }
	// CL-726: signing follow-up "load more" pages of the All feed (global-visibility scoped;
	// needs the update ids so the server can re-verify `canViewProject` per asset).
	| {
			kind: 'global-feed';
			updateIds: string[];
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

	if (value.kind === 'my-clubs-feed') {
		return { kind: 'my-clubs-feed' };
	}

	if (value.kind === 'global-feed' && Array.isArray(value.updateIds)) {
		return {
			kind: 'global-feed',
			updateIds: value.updateIds.filter((id): id is string => typeof id === 'string')
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
	const typedAssetIds = assetIds as Id<'mediaAssets'>[];

	if (context.kind === 'owned') {
		return json({ assets: await getSignedOwnedMediaAssets(convex, typedAssetIds, deliveryConfig) });
	}

	if (context.kind === 'project') {
		return json({
			assets: await getSignedProjectMediaAssets(
				convex,
				context.projectId as Id<'projects'>,
				typedAssetIds,
				deliveryConfig
			)
		});
	}

	if (context.kind === 'my-clubs-feed') {
		// An asset requested here is either an update attachment (`updateFiles`) or an author
		// avatar — the two id spaces don't overlap, so querying both and merging is safe.
		const [authorAssets, mediaAssets] = await Promise.all([
			getSignedViewerUpdateAuthorAssets(convex, typedAssetIds, 50, deliveryConfig),
			getSignedViewerUpdateMediaAssets(convex, typedAssetIds, 50, deliveryConfig)
		]);
		return json({ assets: [...authorAssets, ...mediaAssets] });
	}

	// context.kind === 'global-feed'
	const updateIds = context.updateIds as Id<'updates'>[];
	const [authorAssets, mediaAssets] = await Promise.all([
		getSignedGlobalUpdateAuthorAssets(convex, updateIds, typedAssetIds, deliveryConfig),
		getSignedGlobalUpdateMediaAssets(convex, updateIds, typedAssetIds, deliveryConfig)
	]);
	return json({ assets: [...authorAssets, ...mediaAssets] });
};
