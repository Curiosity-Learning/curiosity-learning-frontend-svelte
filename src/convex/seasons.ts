import { ConvexError, v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { internalMutation, mutation, query } from './_generated/server';
import { requireGlobalAdmin, requireIdentity } from './permissions';
import { isSeasonDate, seasonClosingMoment, seasonStartMoment } from '../lib/domain/season-dates';

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
	applicationDeadline: v.optional(v.number()),
	startDate: v.number(),
	endDate: v.number(),
	reviewWindowOpen: v.number(),
	reviewWindowClose: v.number(),
	feedbackDeadline: v.number()
};

const validateSeasonFields = (fields: {
	applicationDeadline?: number;
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
	// CL-770: scoring starts when applications close, and both happen before the season starts.
	if (fields.applicationDeadline !== undefined) {
		if (fields.reviewWindowOpen < fields.applicationDeadline) {
			throw new ConvexError('reviewWindowOpen must not be before applicationDeadline');
		}
		if (fields.startDate <= fields.reviewWindowClose) {
			throw new ConvexError('startDate must be after reviewWindowClose');
		}
	}
};

// Two seasons closing at the same moment would make "which season is an application for"
// ambiguous (getApplicationIntakeSeason).
const assertUniqueApplicationDeadline = async (
	ctx: MutationCtx,
	applicationDeadline: number | undefined,
	seasonId?: Id<'seasons'>
) => {
	if (applicationDeadline === undefined) return;
	const seasons = await ctx.db.query('seasons').collect();
	if (
		seasons.some(
			(season) => season._id !== seasonId && season.applicationDeadline === applicationDeadline
		)
	) {
		throw new ConvexError('Another season already closes applications on that date');
	}
};

// CL-770: the season an application started or submitted right now is for — its intake is open
// from the previous season's applicationDeadline up to its own, so that is simply the season with
// the earliest applicationDeadline still in the future. Null when no upcoming season has a
// deadline (then nothing can be said about a deadline, and reminders send nothing).
export const getApplicationIntakeSeason = async (
	ctx: QueryCtx | MutationCtx,
	now: number
): Promise<(Doc<'seasons'> & { applicationDeadline: number }) | null> => {
	const seasons = await ctx.db.query('seasons').collect();
	return pickApplicationIntakeSeason(seasons, now);
};

// The in-memory half of getApplicationIntakeSeason, for callers that already hold every season
// and ask about many moments (CL-778's clubApplications.backfillApplicationSeasons).
export const pickApplicationIntakeSeason = (
	seasons: Doc<'seasons'>[],
	now: number
): (Doc<'seasons'> & { applicationDeadline: number }) | null => {
	let intake: (Doc<'seasons'> & { applicationDeadline: number }) | null = null;
	for (const season of seasons) {
		const deadline = season.applicationDeadline;
		if (deadline === undefined || deadline <= now) continue;
		if (!intake || deadline < intake.applicationDeadline) {
			intake = { ...season, applicationDeadline: deadline };
		}
	}
	return intake;
};

export const createSeason = internalMutation({
	args: seasonFields,
	returns: v.id('seasons'),
	handler: async (ctx, args) => {
		validateSeasonFields(args);
		await assertUniqueApplicationDeadline(ctx, args.applicationDeadline);
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
		await assertUniqueApplicationDeadline(ctx, fields.applicationDeadline, seasonId);
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
		await assertUniqueApplicationDeadline(ctx, args.applicationDeadline);
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
		await assertUniqueApplicationDeadline(ctx, fields.applicationDeadline, seasonId);
		await ctx.db.patch(seasonId, {
			...fields,
			updatedAt: Date.now()
		});
		return null;
	}
});

// CL-770: the admin form's writer. Admins pick calendar DATES only (YYYY-MM-DD); the fixed rule in
// lib/domain/season-dates.ts turns them into moments: closing dates are 23:55 GMT, the start is
// 00:00 GMT. Scoring opens the moment applications close (reviewWindowOpen = applicationDeadline),
// so there is no separate "review open" input. adminCreateSeason/adminUpdateSeason above (raw
// timestamps) stay for admin portal builds from before this change.
export const adminSaveSeason = mutation({
	args: {
		seasonId: v.optional(v.id('seasons')),
		name: v.string(),
		applicationDeadline: v.string(),
		reviewWindowClose: v.string(),
		startDate: v.string(),
		endDate: v.string(),
		feedbackDeadline: v.string()
	},
	returns: v.id('seasons'),
	handler: async (ctx, args) => {
		await requireGlobalAdmin(ctx);
		const name = args.name.trim();
		if (!name) throw new ConvexError('Name is required');
		for (const [label, date] of [
			['Applications close', args.applicationDeadline],
			['Scoring deadline', args.reviewWindowClose],
			['Season start', args.startDate],
			['Season end', args.endDate],
			['Feedback deadline', args.feedbackDeadline]
		] as const) {
			if (!isSeasonDate(date)) throw new ConvexError(`${label}: pick a date`);
		}
		const applicationDeadline = seasonClosingMoment(args.applicationDeadline);
		const fields = {
			name,
			applicationDeadline,
			reviewWindowOpen: applicationDeadline,
			reviewWindowClose: seasonClosingMoment(args.reviewWindowClose),
			startDate: seasonStartMoment(args.startDate),
			endDate: seasonClosingMoment(args.endDate),
			feedbackDeadline: seasonClosingMoment(args.feedbackDeadline)
		};
		if (fields.reviewWindowClose <= fields.applicationDeadline) {
			throw new ConvexError('The scoring deadline must be after applications close');
		}
		if (fields.startDate <= fields.reviewWindowClose) {
			throw new ConvexError('The season must start after the scoring deadline');
		}
		if (fields.endDate <= fields.startDate) {
			throw new ConvexError('The season must end after it starts');
		}
		if (fields.feedbackDeadline <= fields.endDate) {
			throw new ConvexError('The feedback deadline must be after the season ends');
		}
		await assertUniqueApplicationDeadline(ctx, applicationDeadline, args.seasonId);

		const now = Date.now();
		if (args.seasonId) {
			const season = await ctx.db.get(args.seasonId);
			if (!season) throw new ConvexError('Season not found');
			await ctx.db.patch(args.seasonId, { ...fields, updatedAt: now });
			return args.seasonId;
		}
		return await ctx.db.insert('seasons', { ...fields, createdAt: now, updatedAt: now });
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
