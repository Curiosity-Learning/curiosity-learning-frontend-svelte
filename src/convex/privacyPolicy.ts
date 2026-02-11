import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { requireIdentity } from './permissions';

export const getActive = query({
	args: {},
	handler: async (ctx) => {
		const active = await ctx.db
			.query('privacyPolicy')
			.withIndex('by_active', (q) => q.eq('isActive', true))
			.first();
		if (active) {
			return active;
		}

		const latest = await ctx.db.query('privacyPolicy').order('desc').first();
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
			.query('privacyPolicy')
			.withIndex('by_active', (q) => q.eq('isActive', true))
			.collect();
		for (const policy of activePolicies) {
			await ctx.db.patch(policy._id, { isActive: false, updatedAt: Date.now() });
		}

		const id = await ctx.db.insert('privacyPolicy', {
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
