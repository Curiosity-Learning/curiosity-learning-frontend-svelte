import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { requireIdentity } from './permissions';

export const generateUploadUrl = mutation({
	args: {},
	handler: async (ctx) => {
		await requireIdentity(ctx);
		return await ctx.storage.generateUploadUrl();
	}
});

export const debugStorageFile = query({
	args: {
		storageId: v.string()
	},
	handler: async (ctx, args) => {
		const storageId = args.storageId.trim();
		if (!storageId) {
			return {
				ok: false,
				found: false,
				storageId: '',
				url: null,
				metadata: null,
				reason: 'empty_storage_id'
			} as const;
		}

		try {
			const typedStorageId = storageId as Id<'_storage'>;
			const [metadata, url] = await Promise.all([
				ctx.storage.getMetadata(typedStorageId),
				ctx.storage.getUrl(typedStorageId)
			]);

			return {
				ok: metadata !== null,
				found: metadata !== null,
				storageId,
				url,
				metadata: metadata
					? {
						contentType: metadata.contentType ?? null,
						size: metadata.size,
						sha256: metadata.sha256
					}
					: null,
				reason: metadata ? null : 'not_found_in_this_deployment'
			} as const;
		} catch (error) {
			return {
				ok: false,
				found: false,
				storageId,
				url: null,
				metadata: null,
				reason: 'invalid_or_unreadable_storage_id',
				error: error instanceof Error ? error.message : 'Unknown error'
			} as const;
		}
	}
});
