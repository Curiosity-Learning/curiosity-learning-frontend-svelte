import { ConvexError, v } from 'convex/values';
import { internalMutation, query } from './_generated/server';
import { requireIdentity } from './permissions';

// PRD 5.7: foundation CRUD for academic "seasons" (e.g. "Autumn 2026"). All fields are
// absolute ms timestamps (UTC) — same convention as `sessions.startTime`/`endTime`. Only
// internal mutations exist for writes; admin UI + validation/overlap rules land in CL-701.
// Reads are authenticated-only for now (no admin-specific gating yet).

const seasonFields = {
	name: v.string(),
	startDate: v.number(),
	endDate: v.number(),
	reviewWindowOpen: v.number(),
	reviewWindowClose: v.number(),
	feedbackDeadline: v.number()
};

export const createSeason = internalMutation({
	args: seasonFields,
	returns: v.id('seasons'),
	handler: async (ctx, args) => {
		if (args.endDate <= args.startDate) {
			throw new ConvexError('endDate must be after startDate');
		}
		if (args.reviewWindowClose <= args.reviewWindowOpen) {
			throw new ConvexError('reviewWindowClose must be after reviewWindowOpen');
		}
		const now = Date.now();
		return await ctx.db.insert('seasons', {
			...args,
			createdAt: now,
			updatedAt: now
		});
	}
});

export const updateSeason = internalMutation({
	args: {
		seasonId: v.id('seasons'),
		...seasonFields
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const { seasonId, ...fields } = args;
		const season = await ctx.db.get(seasonId);
		if (!season) {
			throw new ConvexError('Season not found');
		}
		if (fields.endDate <= fields.startDate) {
			throw new ConvexError('endDate must be after startDate');
		}
		if (fields.reviewWindowClose <= fields.reviewWindowOpen) {
			throw new ConvexError('reviewWindowClose must be after reviewWindowOpen');
		}
		await ctx.db.patch(seasonId, {
			...fields,
			updatedAt: Date.now()
		});
		return null;
	}
});

// Returns the season whose [startDate, endDate] window contains "now", or the closest upcoming
// season if none is currently active, else null.
export const getCurrentSeason = query({
	args: {},
	returns: v.any(),
	handler: async (ctx) => {
		await requireIdentity(ctx);
		const now = Date.now();
		const seasons = await ctx.db.query('seasons').withIndex('by_start_date').collect();
		const active = seasons.find((season) => season.startDate <= now && now <= season.endDate);
		if (active) return active;

		const upcoming = seasons
			.filter((season) => season.startDate > now)
			.sort((a, b) => a.startDate - b.startDate);
		return upcoming[0] ?? null;
	}
});

export const listSeasons = query({
	args: {},
	returns: v.array(v.any()),
	handler: async (ctx) => {
		await requireIdentity(ctx);
		return await ctx.db.query('seasons').withIndex('by_start_date').order('desc').collect();
	}
});
