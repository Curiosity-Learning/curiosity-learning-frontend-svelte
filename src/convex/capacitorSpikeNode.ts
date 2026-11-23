'use node';

import { v } from 'convex/values';
import { action } from './_generated/server';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import {
	createCloudFrontSignedUrl,
	loadCloudFrontConfigFromEnvRecord
} from '../lib/server/cloudfront-sign';

// CL-819 spike, acceptance check 6: signed CloudFront media must load in the native WebView. The
// bundled app has no SvelteKit server to sign through (/api/media/refresh), so this signs the
// caller's own newest ready image and video, the way clubApplicationsNode signs the application
// video for the admin portal. Both queries run as the caller: only their own assets come back.
const signed = v.union(
	v.null(),
	v.object({
		assetId: v.string(),
		contentType: v.union(v.string(), v.null()),
		url: v.string(),
		expiresAt: v.number()
	})
);

type Signed = { assetId: string; contentType: string | null; url: string; expiresAt: number };

export const signedMediaSample = action({
	args: {},
	returns: v.object({ cdnConfigured: v.boolean(), image: signed, video: signed }),
	handler: async (
		ctx
	): Promise<{ cdnConfigured: boolean; image: Signed | null; video: Signed | null }> => {
		const cdnConfig = loadCloudFrontConfigFromEnvRecord(process.env);
		const uploads = await ctx.runQuery(api.media.listMyUploads, { status: 'ready' });
		const newestImage = uploads.find((asset) => asset.mediaKind === 'image');
		const newestVideo = uploads.find((asset) => asset.mediaKind === 'video');
		const ids: Id<'mediaAssets'>[] = [newestImage, newestVideo].flatMap((asset) =>
			asset ? [asset.assetId] : []
		);
		if (!cdnConfig || ids.length === 0) {
			return { cdnConfigured: Boolean(cdnConfig), image: null, video: null };
		}
		const delivery = (await ctx.runQuery(api.media.getOwnedDeliveryAssets, {
			assetIds: ids
		})) as Array<{
			assetId: string;
			deliveryObjectKey: string | null;
			mediaKind: string | null;
			contentType: string | null;
			durationSeconds: number | null;
		}>;
		const sign = (assetId: string | undefined): Signed | null => {
			const asset = delivery.find((row) => row.assetId === assetId);
			if (!asset?.deliveryObjectKey) return null;
			const result = createCloudFrontSignedUrl(cdnConfig, {
				objectKey: asset.deliveryObjectKey,
				mediaKind: asset.mediaKind,
				contentType: asset.contentType,
				durationSeconds: asset.durationSeconds
			});
			return {
				assetId: asset.assetId,
				contentType: asset.contentType,
				url: result.signedUrl,
				expiresAt: result.expiresAt
			};
		};
		return {
			cdnConfigured: true,
			image: sign(newestImage?.assetId),
			video: sign(newestVideo?.assetId)
		};
	}
});
