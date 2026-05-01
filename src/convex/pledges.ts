import { query } from './_generated/server';

export const listActive = query({
	args: {},
	handler: async (ctx) => {
		return await ctx.db
			.query('pledges')
			.withIndex('by_active_and_order', (q) => q.eq('isActive', true))
			.collect();
	}
});
