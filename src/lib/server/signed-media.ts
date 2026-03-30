import { api } from '$convex/_generated/api';
import type { Id } from '$convex/_generated/dataModel';
import { getConvexServerClient } from '$lib/server/convex';
import {
	createCloudFrontSignedUrl,
	loadMediaDeliveryConfigOrNull,
	type MediaDeliveryConfig
} from '$lib/server/media-delivery';

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

export const getSignedOwnedMediaAsset = async (
	convex: ConvexServerClient,
	assetId: Id<'mediaAssets'>,
	config?: MediaDeliveryConfig | null
) => {
	const assets = await getSignedOwnedMediaAssets(convex, [assetId], config);
	return assets[0] ?? null;
};

export const getSignedOwnedMediaAssets = async (
	convex: ConvexServerClient,
	assetIds: Id<'mediaAssets'>[],
	config?: MediaDeliveryConfig | null
) => {
	const uniqueAssetIds = [...new Set(assetIds)];
	if (!uniqueAssetIds.length) {
		return [] as SignedDeliveryAsset[];
	}

	const deliveryAssets = await convex.query(api.media.getOwnedDeliveryAssets, {
		assetIds: uniqueAssetIds
	});

	return signDeliveryAssets(deliveryAssets, config);
};

export const getSignedProjectMediaAssets = async (
	convex: ConvexServerClient,
	projectId: Id<'projects'>,
	assetIds: Id<'mediaAssets'>[],
	config?: MediaDeliveryConfig | null
) => {
	const uniqueAssetIds = [...new Set(assetIds)];
	if (!uniqueAssetIds.length) {
		return [] as SignedDeliveryAsset[];
	}

	const deliveryAssets = await convex.query(api.updates.getProjectDeliveryAssets, {
		projectId,
		assetIds: uniqueAssetIds
	});

	return signDeliveryAssets(deliveryAssets, config);
};

export const getSignedClubMemberProfileAssets = async (
	convex: ConvexServerClient,
	clubId: Id<'clubs'>,
	assetIds: Id<'mediaAssets'>[],
	config?: MediaDeliveryConfig | null
) => {
	const uniqueAssetIds = [...new Set(assetIds)];
	if (!uniqueAssetIds.length) {
		return [] as SignedDeliveryAsset[];
	}

	const deliveryAssets = await convex.query(api.clubs.getMemberProfileDeliveryAssets, {
		clubId,
		assetIds: uniqueAssetIds
	});

	return signDeliveryAssets(deliveryAssets, config);
};

export const getSignedClubProfileAssets = async (
	convex: ConvexServerClient,
	clubId: Id<'clubs'>,
	assetIds: Id<'mediaAssets'>[],
	config?: MediaDeliveryConfig | null
) => {
	const uniqueAssetIds = [...new Set(assetIds)];
	if (!uniqueAssetIds.length) {
		return [] as SignedDeliveryAsset[];
	}

	const deliveryAssets = await convex.query(api.clubs.getProfileDeliveryAssets, {
		clubId,
		assetIds: uniqueAssetIds
	});

	return signDeliveryAssets(deliveryAssets, config);
};

export const getSignedProjectMemberProfileAssets = async (
	convex: ConvexServerClient,
	projectId: Id<'projects'>,
	assetIds: Id<'mediaAssets'>[],
	config?: MediaDeliveryConfig | null
) => {
	const uniqueAssetIds = [...new Set(assetIds)];
	if (!uniqueAssetIds.length) {
		return [] as SignedDeliveryAsset[];
	}

	const deliveryAssets = await convex.query(api.projects.getMemberProfileDeliveryAssets, {
		projectId,
		assetIds: uniqueAssetIds
	});

	return signDeliveryAssets(deliveryAssets, config);
};

export const getSignedViewerUpdateAuthorAssets = async (
	convex: ConvexServerClient,
	assetIds: Id<'mediaAssets'>[],
	limit = 50,
	config?: MediaDeliveryConfig | null
) => {
	const uniqueAssetIds = [...new Set(assetIds)];
	if (!uniqueAssetIds.length) {
		return [] as SignedDeliveryAsset[];
	}

	const deliveryAssets = await convex.query(api.updates.getViewerAuthorDeliveryAssets, {
		assetIds: uniqueAssetIds,
		limit
	});

	return signDeliveryAssets(deliveryAssets, config);
};
