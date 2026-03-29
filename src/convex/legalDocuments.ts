import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server';
import type { QueryCtx } from './_generated/server';
import { requireIdentity } from './permissions';

const legalDocumentKeyValidator = v.union(
	v.literal('privacy_policy'),
	v.literal('terms_and_conditions'),
	v.literal('cookie_policy')
);

const legalDocumentNameByKey = {
	privacy_policy: 'Privacy Policy',
	terms_and_conditions: 'Terms and Conditions',
	cookie_policy: 'Cookie Policy'
} as const;

type LegalDocumentKey = keyof typeof legalDocumentNameByKey;

const legalDocumentKeys = Object.keys(legalDocumentNameByKey) as LegalDocumentKey[];

const getActiveOrLatestByKey = async (ctx: QueryCtx, documentKey: LegalDocumentKey) => {
	const active = await ctx.db
		.query('legalDocuments')
		.withIndex('by_document_key_and_active', (q) =>
			q.eq('documentKey', documentKey).eq('isActive', true)
		)
		.first();
	if (active) return active;

	return await ctx.db
		.query('legalDocuments')
		.withIndex('by_document_key_and_updated', (q) => q.eq('documentKey', documentKey))
		.order('desc')
		.first();
};

export const getActiveByKey = query({
	args: {
		documentKey: legalDocumentKeyValidator
	},
	handler: async (ctx, args) => {
		return await getActiveOrLatestByKey(ctx, args.documentKey);
	}
});

export const listActive = query({
	args: {},
	handler: async (ctx) => {
		const documents = await Promise.all(
			legalDocumentKeys.map((documentKey) => getActiveOrLatestByKey(ctx, documentKey))
		);
		return documents.filter((document) => document !== null);
	}
});

export const upsertActive = mutation({
	args: {
		documentKey: legalDocumentKeyValidator,
		title: v.string(),
		content: v.string(),
		version: v.string()
	},
	handler: async (ctx, args) => {
		await requireIdentity(ctx);

		const activeDocuments = await ctx.db
			.query('legalDocuments')
			.withIndex('by_document_key_and_active', (q) =>
				q.eq('documentKey', args.documentKey).eq('isActive', true)
			)
			.collect();

		for (const document of activeDocuments) {
			await ctx.db.patch(document._id, { isActive: false, updatedAt: Date.now() });
		}

		const id = await ctx.db.insert('legalDocuments', {
			documentKey: args.documentKey,
			fullName: legalDocumentNameByKey[args.documentKey],
			title: args.title,
			content: args.content,
			version: args.version,
			isActive: true,
			createdAt: Date.now(),
			updatedAt: Date.now()
		});

		const current = await ctx.db.get(id);
		if (!current) {
			throw new ConvexError('Failed to create legal document');
		}
		return current;
	}
});
