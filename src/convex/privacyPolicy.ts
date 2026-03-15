import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { requireIdentity } from './permissions';

const PRIVACY_KEY = 'privacy_policy' as const;

export const getActive = query({
	args: {},
	handler: async (ctx) => {
		const active = await ctx.db
			.query('legalDocuments')
			.withIndex('by_document_key_and_active', (q) =>
				q.eq('documentKey', PRIVACY_KEY).eq('isActive', true)
			)
			.first();
		if (active) {
			return active;
		}

		const latest = await ctx.db
			.query('legalDocuments')
			.withIndex('by_document_key_and_updated', (q) => q.eq('documentKey', PRIVACY_KEY))
			.order('desc')
			.first();
		if (!latest) {
			return null;
		}
		return latest;
	}
});

export const upsertActive = mutation({
	args: {
		title: v.string(),
		content: v.string(),
		version: v.string()
	},
	handler: async (ctx, args) => {
		await requireIdentity(ctx);

		const activePolicies = await ctx.db
			.query('legalDocuments')
			.withIndex('by_document_key_and_active', (q) =>
				q.eq('documentKey', PRIVACY_KEY).eq('isActive', true)
			)
			.collect();
		for (const policy of activePolicies) {
			await ctx.db.patch(policy._id, { isActive: false, updatedAt: Date.now() });
		}

		const id = await ctx.db.insert('legalDocuments', {
			documentKey: PRIVACY_KEY,
			fullName: 'Privacy Policy',
			title: args.title,
			content: args.content,
			version: args.version,
			isActive: true,
			createdAt: Date.now(),
			updatedAt: Date.now()
		});
		const current = await ctx.db.get(id);
		if (!current) {
			throw new ConvexError('Failed to create policy');
		}
		return current;
	}
});
