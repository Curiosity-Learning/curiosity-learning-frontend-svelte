import { api } from '$convex/_generated/api';
import type { Id } from '$convex/_generated/dataModel';
import { getConvexServerClient } from '$lib/server/convex';
import {
	createCloudFrontSignedUrl,
	loadMediaDeliveryConfigOrNull,
	type MediaDeliveryConfig
} from '$lib/server/media-delivery';
import type { FunctionReference } from 'convex/server';

type ConvexServerClient = ReturnType<typeof getConvexServerClient>;

export type DeliveryAssetRecord = {
	assetId: Id<'mediaAssets'>;
	storageProvider: 's3';
	deliveryBucket: string | null;
	deliveryObjectKey: string | null;
	mediaKind: 'image' | 'video' | null;
	contentType: string | null;
	durationSeconds: number | null;
};

export type SignedDeliveryAsset = {
	assetId: Id<'mediaAssets'>;
	mediaKind: 'image' | 'video' | null;
	contentType: string | null;
	durationSeconds: number | null;
	signedUrl: string;
	expiresAt: number;
};

const hasDeliveryObjectKey = (
	asset: DeliveryAssetRecord | null | undefined
): asset is DeliveryAssetRecord & { deliveryObjectKey: string } => Boolean(asset?.deliveryObjectKey);

export const signDeliveryAsset = (
	asset: DeliveryAssetRecord | null | undefined,
	config: MediaDeliveryConfig | null = loadMediaDeliveryConfigOrNull()
): SignedDeliveryAsset | null => {
	if (!config || !hasDeliveryObjectKey(asset)) {
		return null;
	}

	const delivery = createCloudFrontSignedUrl(config, {
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
};

export const signDeliveryAssets = (
	assets: Array<DeliveryAssetRecord | null | undefined>,
	config: MediaDeliveryConfig | null = loadMediaDeliveryConfigOrNull()
): SignedDeliveryAsset[] =>
	assets
		.map((asset) => signDeliveryAsset(asset, config))
		.filter((asset): asset is SignedDeliveryAsset => asset !== null);

// Shared backbone for every "look up delivery assets for some ids, then sign them" export below:
// dedupe the ids, return early (without a round-trip) if there's nothing to ask for, run the
// query, and sign whatever comes back. `argsBuilder` maps the deduped ids to that query's actual
// args shape (each query takes the ids under a different key, sometimes alongside an unrelated
// scalar arg like a clubId/projectId/limit that the wrapper closes over).
const getSignedAssets = async <Args extends Record<string, unknown>, TId>(
	convex: ConvexServerClient,
	queryRef: FunctionReference<'query', 'public', Args, Array<DeliveryAssetRecord | null | undefined>>,
	argsBuilder: (ids: TId[]) => Args,
	ids: TId[],
	config?: MediaDeliveryConfig | null
): Promise<SignedDeliveryAsset[]> => {
	const uniqueIds = [...new Set(ids)];
	if (!uniqueIds.length) {
		return [];
	}

	// `Args` is opaque inside this generic helper, which trips up `OptionalRestArgs`'s conditional
	// resolution against the (concrete, per-call-site) `queryRef`/`argsBuilder` pairing below —
	// each of the 13 wrappers still gets full type-checking on its own queryRef/argsBuilder pair,
	// only this shared plumbing line needs the escape hatch.
	const deliveryAssets = (await convex.query(queryRef, argsBuilder(uniqueIds) as never)) as Array<
		DeliveryAssetRecord | null | undefined
	>;
	return signDeliveryAssets(deliveryAssets, config);
};

export const getSignedOwnedMediaAsset = async (
	convex: ConvexServerClient,
	assetId: Id<'mediaAssets'>,
	config?: MediaDeliveryConfig | null
) => {
	const assets = await getSignedOwnedMediaAssets(convex, [assetId], config);
	return assets[0] ?? null;
};

export const getSignedOwnedMediaAssets = (
	convex: ConvexServerClient,
	assetIds: Id<'mediaAssets'>[],
	config?: MediaDeliveryConfig | null
) =>
	getSignedAssets(convex, api.media.getOwnedDeliveryAssets, (ids) => ({ assetIds: ids }), assetIds, config);

// CL-710 CEO review round 3 (Braga video bug): signs the single application video asset, the same
// way `getSignedOwnedMediaAsset` signs a single owned asset. Authorization (applicant, assigned
// reviewer, or reviewer who already reviewed) happens inside
// clubApplications.getApplicationVideoDeliveryAsset — this wrapper just signs whatever it returns.
export const getSignedApplicationVideoAsset = async (
	convex: ConvexServerClient,
	applicationId: Id<'clubApplications'>,
	config?: MediaDeliveryConfig | null
): Promise<SignedDeliveryAsset | null> => {
	const asset = await convex.query(api.clubApplications.getApplicationVideoDeliveryAsset, {
		applicationId
	});
	return signDeliveryAsset(asset as DeliveryAssetRecord | null, config);
};

export const getSignedProjectMediaAssets = (
	convex: ConvexServerClient,
	projectId: Id<'projects'>,
	assetIds: Id<'mediaAssets'>[],
	config?: MediaDeliveryConfig | null
) =>
	getSignedAssets(
		convex,
		api.updates.getProjectDeliveryAssets,
		(ids) => ({ projectId, assetIds: ids }),
		assetIds,
		config
	);

export const getSignedClubMemberProfileAssets = (
	convex: ConvexServerClient,
	clubId: Id<'clubs'>,
	assetIds: Id<'mediaAssets'>[],
	config?: MediaDeliveryConfig | null
) =>
	getSignedAssets(
		convex,
		api.clubs.getMemberProfileDeliveryAssets,
		(ids) => ({ clubId, assetIds: ids }),
		assetIds,
		config
	);

export const getSignedClubProfileAssets = (
	convex: ConvexServerClient,
	clubId: Id<'clubs'>,
	assetIds: Id<'mediaAssets'>[],
	config?: MediaDeliveryConfig | null
) =>
	getSignedAssets(
		convex,
		api.clubs.getProfileDeliveryAssets,
		(ids) => ({ clubId, assetIds: ids }),
		assetIds,
		config
	);

export const getSignedProjectMemberProfileAssets = (
	convex: ConvexServerClient,
	projectId: Id<'projects'>,
	assetIds: Id<'mediaAssets'>[],
	config?: MediaDeliveryConfig | null
) =>
	getSignedAssets(
		convex,
		api.projects.getMemberProfileDeliveryAssets,
		(ids) => ({ projectId, assetIds: ids }),
		assetIds,
		config
	);

export const getSignedProjectCoverAssets = (
	convex: ConvexServerClient,
	projectIds: Id<'projects'>[],
	config?: MediaDeliveryConfig | null
) =>
	getSignedAssets(
		convex,
		api.projects.getCoverDeliveryAssets,
		(ids) => ({ projectIds: ids }),
		projectIds,
		config
	);

export const getSignedSessionPhotoAssets = (
	convex: ConvexServerClient,
	sessionId: Id<'sessions'>,
	assetIds: Id<'mediaAssets'>[],
	config?: MediaDeliveryConfig | null
) =>
	getSignedAssets(
		convex,
		api.sessions.getSessionPhotoDeliveryAssets,
		(ids) => ({ sessionId, assetIds: ids }),
		assetIds,
		config
	);

export const getSignedViewerUpdateAuthorAssets = (
	convex: ConvexServerClient,
	assetIds: Id<'mediaAssets'>[],
	limit = 50,
	config?: MediaDeliveryConfig | null
) =>
	getSignedAssets(
		convex,
		api.updates.getViewerAuthorDeliveryAssets,
		(ids) => ({ assetIds: ids, limit }),
		assetIds,
		config
	);

export const getSignedViewerUpdateMediaAssets = (
	convex: ConvexServerClient,
	assetIds: Id<'mediaAssets'>[],
	limit = 50,
	config?: MediaDeliveryConfig | null
) =>
	getSignedAssets(
		convex,
		api.updates.getViewerUpdateMediaDeliveryAssets,
		(ids) => ({ assetIds: ids, limit }),
		assetIds,
		config
	);

export const getSignedGlobalUpdateAuthorAssets = (
	convex: ConvexServerClient,
	updateIds: Id<'updates'>[],
	assetIds: Id<'mediaAssets'>[],
	config?: MediaDeliveryConfig | null
): Promise<SignedDeliveryAsset[]> => {
	if (!updateIds.length) {
		return Promise.resolve([]);
	}
	return getSignedAssets(
		convex,
		api.updates.getGlobalAuthorDeliveryAssets,
		(ids) => ({ updateIds: [...new Set(updateIds)], assetIds: ids }),
		assetIds,
		config
	);
};

export const getSignedProfileAssets = (
	convex: ConvexServerClient,
	profileId: Id<'profiles'>,
	assetIds: Id<'mediaAssets'>[],
	config?: MediaDeliveryConfig | null
) =>
	getSignedAssets(
		convex,
		api.profiles.getProfileDeliveryAssets,
		(ids) => ({ profileId, assetIds: ids }),
		assetIds,
		config
	);

export const getSignedGlobalUpdateMediaAssets = (
	convex: ConvexServerClient,
	updateIds: Id<'updates'>[],
	assetIds: Id<'mediaAssets'>[],
	config?: MediaDeliveryConfig | null
): Promise<SignedDeliveryAsset[]> => {
	if (!updateIds.length) {
		return Promise.resolve([]);
	}
	return getSignedAssets(
		convex,
		api.updates.getGlobalUpdateMediaDeliveryAssets,
		(ids) => ({ updateIds: [...new Set(updateIds)], assetIds: ids }),
		assetIds,
		config
	);
};
