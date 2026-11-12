'use node';

import { v } from 'convex/values';
import { action } from './_generated/server';
import { api } from './_generated/api';
import {
	createCloudFrontSignedUrl,
	loadCloudFrontConfigFromEnvRecord
} from '../lib/server/cloudfront-sign';
import { loadMediaStorageConfigOrNull, resolveMediaObjectUrl } from './mediaStorage';

// Signs a flagged media asset's delivery URL for the admin portal's moderation queue, so staff
// can see what was actually flagged instead of just the owner id. Same shape and rationale as
// clubApplicationsNode.getApplicationVideoSignedUrl: the admin portal is a pure Convex client
// with no signing-capable server of its own, and the media bucket is private behind CloudFront.
//
// Authorization is getFlaggedMediaDeliveryAsset's requireGlobalAdmin — the runQuery below
// executes with the caller's identity, so non-admins are rejected there.
export const getFlaggedMediaSignedUrl = action({
	args: {
		mediaAssetId: v.id('mediaAssets')
	},
	returns: v.union(
		v.null(),
		v.object({
			url: v.string(),
			// Unix seconds when the signed URL stops working; null on the direct-URL fallback,
			// which does not expire.
			expiresAt: v.union(v.number(), v.null())
		})
	),
	// The explicit return annotation breaks the type cycle created by referencing `api` (whose
	// type includes this module) inside the handler.
	handler: async (ctx, args): Promise<{ url: string; expiresAt: number | null } | null> => {
		const asset = await ctx.runQuery(api.moderation.getFlaggedMediaDeliveryAsset, {
			mediaAssetId: args.mediaAssetId
		});
		if (!asset?.deliveryObjectKey) {
			return null;
		}

		const cdnConfig = loadCloudFrontConfigFromEnvRecord(process.env);
		if (cdnConfig) {
			const signed = createCloudFrontSignedUrl(cdnConfig, {
				objectKey: asset.deliveryObjectKey,
				mediaKind: asset.mediaKind,
				contentType: asset.contentType,
				durationSeconds: asset.durationSeconds
			});
			return { url: signed.signedUrl, expiresAt: signed.expiresAt };
		}

		// No CDN signing configured (local dev with a public bucket): fall back to the direct
		// storage URL, mirroring resolveMediaAssetFileUrl.
		const storageConfig = loadMediaStorageConfigOrNull();
		if (!storageConfig || !asset.deliveryBucket) {
			return null;
		}
		return {
			url: resolveMediaObjectUrl({
				bucket: asset.deliveryBucket,
				objectKey: asset.deliveryObjectKey,
				config: storageConfig
			}),
			expiresAt: null
		};
	}
});
