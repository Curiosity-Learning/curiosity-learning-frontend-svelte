'use node';

import { v } from 'convex/values';
import { action } from './_generated/server';
import { api } from './_generated/api';
import {
	createCloudFrontSignedUrl,
	loadCloudFrontConfigFromEnvRecord
} from '../lib/server/cloudfront-sign';
import { loadMediaStorageConfigOrNull, resolveMediaObjectUrl } from './mediaStorage';

// Signs the application video's delivery URL server-side, for clients that are pure Convex
// clients with no signing-capable web server of their own — today the admin portal
// (curiosity-learning-admin), whose review page was left reading adminGetApplication's direct
// storage URL and silently 403ing once the bucket went private behind CloudFront signing.
// The member app keeps using its own /api/media/refresh route (src/lib/server/signed-media.ts);
// both paths share the signing core in src/lib/server/cloudfront-sign.ts and the CloudFront env
// vars, which are already set on the Convex deployment.
//
// Authorization is getApplicationVideoDeliveryAsset's: applicant, assigned reviewer, reviewer
// who reviewed it, or global admin (canAccessApplicationVideo) — the runQuery below executes
// with the caller's identity, so an unauthorized caller gets its 'Permission denied'.
export const getApplicationVideoSignedUrl = action({
	args: {
		applicationId: v.id('clubApplications')
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
	handler: async (ctx, args) => {
		const asset = await ctx.runQuery(api.clubApplications.getApplicationVideoDeliveryAsset, {
			applicationId: args.applicationId
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
