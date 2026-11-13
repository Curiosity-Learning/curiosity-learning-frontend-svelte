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
	applicationDeadlineExtendedTo: v.optional(v.number()),
	startDate: v.number(),
	endDate: v.number(),
	reviewWindowOpen: v.number(),
	reviewWindowClose: v.number(),
	feedbackDeadline: v.number()
};

// CL-777: "when applications really close" — the extension if one is set, else the normal
// deadline. Every rule that means the real closing moment (which season an application is for,
// when scoring opens, reminder emails) uses this, never `applicationDeadline` directly.
export const effectiveApplicationDeadline = (season: {
	applicationDeadline?: number;
	applicationDeadlineExtendedTo?: number;
}): number | undefined => season.applicationDeadlineExtendedTo ?? season.applicationDeadline;

const validateSeasonFields = (fields: {
	applicationDeadline?: number;
	applicationDeadlineExtendedTo?: number;
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
	if (fields.applicationDeadlineExtendedTo !== undefined) {
		if (fields.applicationDeadline === undefined) {
			throw new ConvexError('applicationDeadlineExtendedTo needs an applicationDeadline');
		}
		if (fields.applicationDeadlineExtendedTo <= fields.applicationDeadline) {
			throw new ConvexError('applicationDeadlineExtendedTo must be after applicationDeadline');
		}
	}
	// CL-770: scoring starts when applications close, and both happen before the season starts.
	const closesAt = effectiveApplicationDeadline(fields);
	if (closesAt !== undefined) {
		if (fields.reviewWindowOpen < closesAt) {
			throw new ConvexError('reviewWindowOpen must not be before the application deadline');
		}
		if (fields.startDate <= fields.reviewWindowClose) {
			throw new ConvexError('startDate must be after reviewWindowClose');
		}
	}
};

// Two seasons closing at the same moment would make "which season is an application for"
// ambiguous (getApplicationIntakeSeason). Compared on the effective deadline (CL-777), which is
// the one that decides.
const assertUniqueApplicationDeadline = async (
	ctx: MutationCtx,
	closesAt: number | undefined,
	seasonId?: Id<'seasons'>
) => {
	if (closesAt === undefined) return;
	const seasons = await ctx.db.query('seasons').collect();
	if (
		seasons.some(
			(season) => season._id !== seasonId && effectiveApplicationDeadline(season) === closesAt
		)
	) {
		throw new ConvexError('Another season already closes applications on that date');
	}
};

// A season taking applications, with `closesAt` = its effective application deadline (CL-777).
export type IntakeSeason = Doc<'seasons'> & { closesAt: number };

// CL-770: the season an application started or submitted right now is for — its intake is open
// from the previous season's deadline up to its own, so that is simply the season with the
// earliest effective deadline (CL-777: the extension if set) still in the future. Null when no
// upcoming season has a deadline (then nothing can be said about a deadline, and reminders send
// nothing).
export const getApplicationIntakeSeason = async (
	ctx: QueryCtx | MutationCtx,
	now: number
): Promise<IntakeSeason | null> => {
	const seasons = await ctx.db.query('seasons').collect();
	return pickApplicationIntakeSeason(seasons, now);
};

// The in-memory half of getApplicationIntakeSeason, for callers that already hold every season
// and ask about many moments (CL-778's clubApplications.backfillApplicationSeasons).
export const pickApplicationIntakeSeason = (
	seasons: Doc<'seasons'>[],
	now: number
): IntakeSeason | null => {
	let intake: IntakeSeason | null = null;
	for (const season of seasons) {
		const deadline = effectiveApplicationDeadline(season);
		if (deadline === undefined || deadline <= now) continue;
		if (!intake || deadline < intake.closesAt) {
			intake = { ...season, closesAt: deadline };
		}
	}
	return intake;
};

export const createSeason = internalMutation({
	args: seasonFields,
	returns: v.id('seasons'),
	handler: async (ctx, args) => {
		validateSeasonFields(args);
		await assertUniqueApplicationDeadline(ctx, effectiveApplicationDeadline(args));
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
		const { seasonId, ...given } = args;
		const season = await ctx.db.get(seasonId);
		if (!season) {
			throw new ConvexError('Season not found');
		}
		// CL-777: an omitted extension keeps the stored one, and is checked with the new dates.
		const fields = {
			...given,
			applicationDeadlineExtendedTo:
				given.applicationDeadlineExtendedTo ?? season.applicationDeadlineExtendedTo
		};
		validateSeasonFields(fields);
		await assertUniqueApplicationDeadline(ctx, effectiveApplicationDeadline(fields), seasonId);
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
		await assertUniqueApplicationDeadline(ctx, effectiveApplicationDeadline(args));
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
		const { seasonId, ...given } = args;
		const season = await ctx.db.get(seasonId);
		if (!season) {
			throw new ConvexError('Season not found');
		}
		// CL-777: an omitted extension keeps the stored one, and is checked with the new dates.
		const fields = {
			...given,
			applicationDeadlineExtendedTo:
				given.applicationDeadlineExtendedTo ?? season.applicationDeadlineExtendedTo
		};
		validateSeasonFields(fields);
		await assertUniqueApplicationDeadline(ctx, effectiveApplicationDeadline(fields), seasonId);
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
//
// CL-777: `applicationDeadlineExtendedTo` is an optional "Extended to" date. Omitted keeps whatever
// the season already has (so an admin portal build from before CL-777 never wipes an extension);
// an empty string or null removes it. Scoring opens at the effective deadline.
export const adminSaveSeason = mutation({
	args: {
		seasonId: v.optional(v.id('seasons')),
		name: v.string(),
		applicationDeadline: v.string(),
		applicationDeadlineExtendedTo: v.optional(v.union(v.string(), v.null())),
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
		const existing = args.seasonId ? await ctx.db.get(args.seasonId) : null;
		if (args.seasonId && !existing) throw new ConvexError('Season not found');
		let applicationDeadlineExtendedTo: number | undefined;
		if (args.applicationDeadlineExtendedTo === undefined) {
			applicationDeadlineExtendedTo = existing?.applicationDeadlineExtendedTo;
		} else if (args.applicationDeadlineExtendedTo) {
			if (!isSeasonDate(args.applicationDeadlineExtendedTo)) {
				throw new ConvexError('Extended to: pick a date');
			}
			applicationDeadlineExtendedTo = seasonClosingMoment(args.applicationDeadlineExtendedTo);
		}
		const applicationDeadline = seasonClosingMoment(args.applicationDeadline);
		const closesAt = applicationDeadlineExtendedTo ?? applicationDeadline;
		const fields = {
			name,
			applicationDeadline,
			applicationDeadlineExtendedTo,
			reviewWindowOpen: closesAt,
			reviewWindowClose: seasonClosingMoment(args.reviewWindowClose),
			startDate: seasonStartMoment(args.startDate),
			endDate: seasonClosingMoment(args.endDate),
			feedbackDeadline: seasonClosingMoment(args.feedbackDeadline)
		};
		if (
			applicationDeadlineExtendedTo !== undefined &&
			applicationDeadlineExtendedTo <= applicationDeadline
		) {
			throw new ConvexError('The extended date must be after the normal closing date');
		}
		if (fields.reviewWindowClose <= closesAt) {
			throw new ConvexError(
				applicationDeadlineExtendedTo !== undefined
					? 'The scoring deadline must be after the extended closing date'
					: 'The scoring deadline must be after applications close'
			);
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
		await assertUniqueApplicationDeadline(ctx, closesAt, args.seasonId);

		const now = Date.now();
		if (args.seasonId) {
			await ctx.db.patch(args.seasonId, { ...fields, updatedAt: now });
			return args.seasonId;
		}
		return await ctx.db.insert('seasons', { ...fields, createdAt: now, updatedAt: now });
	}
});

// CL-777 one-off backfill, run by hand after the deploy (dry run first):
//
//   npx convex run seasons:backfillWinter2026Extension '{"dryRun": true}' --prod
//   npx convex run seasons:backfillWinter2026Extension '{"dryRun": false}' --prod
//
// Winter 2026 should have closed on 31 Oct and was extended to 7 Nov; before CL-777 it stored
// 7 Nov as its `applicationDeadline`. This moves it to 31 Oct + "extended to" 7 Nov. The effective
// deadline (and so `reviewWindowOpen`, the intake season of every application, and scoring) stays
// 7 Nov 23:55 GMT, so nothing behaves differently. It refuses to touch the season when it does
// not look exactly like that, and does nothing on a second run.
const WINTER_2026_NAME = 'Winter 2026';
const WINTER_2026_NORMAL_DEADLINE = '2026-10-31';
const WINTER_2026_EXTENDED_TO = '2026-11-07';

export const backfillWinter2026Extension = internalMutation({
	args: { dryRun: v.boolean() },
	returns: v.object({
		status: v.union(v.literal('updated'), v.literal('would_update'), v.literal('already_done')),
		seasonId: v.id('seasons'),
		applicationDeadline: v.string(),
		applicationDeadlineExtendedTo: v.string(),
		reviewWindowOpen: v.string()
	}),
	handler: async (ctx, args) => {
		const normal = seasonClosingMoment(WINTER_2026_NORMAL_DEADLINE);
		const extended = seasonClosingMoment(WINTER_2026_EXTENDED_TO);
		const matches = (await ctx.db.query('seasons').collect()).filter(
			(season) => season.name.trim() === WINTER_2026_NAME
		);
		if (matches.length !== 1) {
			throw new ConvexError(
				`Expected one season named "${WINTER_2026_NAME}", found ${matches.length}`
			);
		}
		const season = matches[0];
		const report = (status: 'updated' | 'would_update' | 'already_done') => ({
			status,
			seasonId: season._id,
			applicationDeadline: new Date(normal).toISOString(),
			applicationDeadlineExtendedTo: new Date(extended).toISOString(),
			reviewWindowOpen: new Date(season.reviewWindowOpen).toISOString()
		});
		if (
			season.applicationDeadline === normal &&
			season.applicationDeadlineExtendedTo === extended
		) {
			return report('already_done');
		}
		if (
			season.applicationDeadline !== extended ||
			season.applicationDeadlineExtendedTo !== undefined
		) {
			throw new ConvexError(
				`${WINTER_2026_NAME} does not close on ${WINTER_2026_EXTENDED_TO} 23:55 GMT without an extension; not touching it`
			);
		}
		if (season.reviewWindowOpen < extended) {
			throw new ConvexError(
				`${WINTER_2026_NAME} scoring opens before ${WINTER_2026_EXTENDED_TO}; not touching it`
			);
		}
		if (args.dryRun) return report('would_update');
		await ctx.db.patch(season._id, {
			applicationDeadline: normal,
			applicationDeadlineExtendedTo: extended,
			updatedAt: Date.now()
		});
		return report('updated');
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
