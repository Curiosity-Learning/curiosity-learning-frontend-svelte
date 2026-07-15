import { ConvexError, v } from 'convex/values';
import { internalMutation, mutation, query } from './_generated/server';
import { requireGlobalAdmin, requireIdentity } from './permissions';

// PRD 5.7: foundation CRUD for academic "seasons" (e.g. "Autumn 2026"). All fields are
// absolute ms timestamps (UTC) — same convention as `sessions.startTime`/`endTime`.
// PRD 6.14.5 (CL-701): admin-gated `adminListSeasons`/`adminCreateSeason`/`adminUpdateSeason`
// are the only writer surface exposed to the admin UI; the internal mutations below remain for
// scripts/tests. There is deliberately no delete — seasons drive history and season transitions
// are non-destructive by design (nothing about a season boundary resets or deletes other data;
// see booklet.ts / sessions.ts, which never key deletion off season boundaries). Reads are
// authenticated-only for the member-facing queries (getCurrentSeason/listSeasons).

const seasonFields = {
	name: v.string(),
	startDate: v.number(),
	endDate: v.number(),
	reviewWindowOpen: v.number(),
	reviewWindowClose: v.number(),
	feedbackDeadline: v.number()
};

const validateSeasonFields = (fields: {
	startDate: number;
	endDate: number;
	reviewWindowOpen: number;
	reviewWindowClose: number;
	feedbackDeadline: number;
}) => {
	if (fields.endDate <= fields.startDate) {
		throw new ConvexError('endDate must be after startDate');
	}
	if (fields.reviewWindowClose <= fields.reviewWindowOpen) {
		throw new ConvexError('reviewWindowClose must be after reviewWindowOpen');
	}
	if (fields.feedbackDeadline <= fields.endDate) {
		throw new ConvexError('feedbackDeadline must be after endDate');
	}
};

export const createSeason = internalMutation({
	args: seasonFields,
	returns: v.id('seasons'),
	handler: async (ctx, args) => {
		validateSeasonFields(args);
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
		validateSeasonFields(fields);
		await ctx.db.patch(seasonId, {
			...fields,
			updatedAt: Date.now()
		});
		return null;
	}
});

// ---------------------------------------------------------------------------
// Admin-gated surface (PRD 6.14.5, CL-701). Every export below calls requireGlobalAdmin first,
// following the admin.ts template. No delete: seasons are permanent history; nothing resets or
// cascades when a season's dates change or a new season starts.
// ---------------------------------------------------------------------------

export const adminListSeasons = query({
	args: {},
	returns: v.array(v.any()),
	handler: async (ctx) => {
		await requireGlobalAdmin(ctx);
		return await ctx.db.query('seasons').withIndex('by_start_date').order('desc').collect();
	}
});

export const adminCreateSeason = mutation({
	args: seasonFields,
	returns: v.id('seasons'),
	handler: async (ctx, args) => {
		await requireGlobalAdmin(ctx);
		validateSeasonFields(args);
		const now = Date.now();
		return await ctx.db.insert('seasons', {
			...args,
			createdAt: now,
			updatedAt: now
		});
	}
});

export const adminUpdateSeason = mutation({
	args: {
		seasonId: v.id('seasons'),
		...seasonFields
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		await requireGlobalAdmin(ctx);
		const { seasonId, ...fields } = args;
		const season = await ctx.db.get(seasonId);
		if (!season) {
			throw new ConvexError('Season not found');
		}
		validateSeasonFields(fields);
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
