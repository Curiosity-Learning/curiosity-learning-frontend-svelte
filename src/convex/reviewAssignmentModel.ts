import { ConvexError, v } from 'convex/values';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { internalMutation, mutation, query } from './_generated/server';
import { requireGlobalAdmin, requireIdentity } from './permissions';

type Ctx = QueryCtx | MutationCtx;

// PRD 6.9.2/6.9.3 (CL-709): windowed auto-assignment for peer review.
//
// Reviews used to be self-select: any Guide could pick up any pending application. This module
// replaces that with assignment. Once a day (crons.ts) — and inline whenever an application is
// submitted while a window is open, so mid-window applicants don't wait a day — every season
// whose [reviewWindowOpen, reviewWindowClose] contains "now" gets `assignReviewsForOpenWindow`
// run for it. That distributes every pending application with fewer than
// `reviewersPerApplication` assignments to additional eligible Guides, picking whoever currently
// has the fewest assignments this season (ties broken by profile id for determinism), skipping
// any Guide already at `maxReviewsPerGuidePerSeason`.
//
// Applications submitted before a window opens, or after it closes, simply stay `pending` with
// no assignment rows — they queue for the season whose window is/becomes open (PRD 6.9.2 point
// 4: "roll into the next season's review cycle"). Nothing marks them specially; the queued state
// *is* "pending with zero assignments".
//
// CL-778: "the season whose window is open" is no longer any season — it is the application's
// own `reviewSeasonId` (the intake season when it was submitted, so a late submission waits for
// the next season instead of being scored in the current one). An application is only assigned
// while ITS review season's window is open; pending applications without a review season are not
// assigned at all (clubApplications.backfillApplicationSeasons runs right after the CL-778
// deploy, and an admin can set a season on anything left over). An application an admin moved to
// another season (admin.adminSetApplicationReviewSeason) is never re-scored: once it has
// reviewers booked against another season, or reviews from Guides not assigned this season, the
// assignment job leaves it alone (see hasReviewHistoryOutsideSeason). If a window is open but there are genuinely no eligible
// Guides (e.g. a from-scratch platform bootstrap with no clubs yet), applications stay queued
// until at least one Guide exists — this is an accepted operational reality, not a bug, and dev
// data always has guides so it won't come up there.

const DEFAULT_REVIEWERS_PER_APPLICATION = 3;
const DEFAULT_MAX_REVIEWS_PER_GUIDE_PER_SEASON = 10;

export const getReviewSettings = async (ctx: Ctx) => {
	const settings = await ctx.db.query('reviewSettings').first();
	return {
		reviewersPerApplication: settings?.reviewersPerApplication ?? DEFAULT_REVIEWERS_PER_APPLICATION,
		maxReviewsPerGuidePerSeason:
			settings?.maxReviewsPerGuidePerSeason ?? DEFAULT_MAX_REVIEWS_PER_GUIDE_PER_SEASON
	};
};

export const adminGetReviewSettings = query({
	args: {},
	returns: v.object({
		reviewersPerApplication: v.number(),
		maxReviewsPerGuidePerSeason: v.number()
	}),
	handler: async (ctx) => {
		await requireGlobalAdmin(ctx);
		return await getReviewSettings(ctx);
	}
});

export const adminUpdateReviewSettings = mutation({
	args: {
		reviewersPerApplication: v.number(),
		maxReviewsPerGuidePerSeason: v.number()
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		await requireGlobalAdmin(ctx);
		if (!Number.isInteger(args.reviewersPerApplication) || args.reviewersPerApplication < 1) {
			throw new ConvexError('reviewersPerApplication must be a positive integer');
		}
		if (
			!Number.isInteger(args.maxReviewsPerGuidePerSeason) ||
			args.maxReviewsPerGuidePerSeason < 1
		) {
			throw new ConvexError('maxReviewsPerGuidePerSeason must be a positive integer');
		}
		const existing = await ctx.db.query('reviewSettings').first();
		const now = Date.now();
		if (existing) {
			await ctx.db.patch(existing._id, {
				reviewersPerApplication: args.reviewersPerApplication,
				maxReviewsPerGuidePerSeason: args.maxReviewsPerGuidePerSeason,
				updatedAt: now
			});
		} else {
			await ctx.db.insert('reviewSettings', {
				reviewersPerApplication: args.reviewersPerApplication,
				maxReviewsPerGuidePerSeason: args.maxReviewsPerGuidePerSeason,
				updatedAt: now
			});
		}
		return null;
	}
});

// The season a MANUAL assignment (admin.adminAssignReviewer, leader-invite backfill) books
// against: the one whose review window is open, else the most recent one. Manual assignments are
// staff decisions and shouldn't fail just because no window is open right now — but they do need
// a season row for the load-balancing indexes.
//
// CL-778: when the application has a review season, the assignment books against THAT season, so
// a hand-picked reviewer counts toward the season the application is actually reviewed in (and
// the assignment job, which leaves applications with reviewers in other seasons alone, does not
// mistake it for an earlier season's review).
export const resolveSeasonForManualAssignment = async (
	ctx: QueryCtx | MutationCtx,
	preferredSeasonId?: Id<'seasons'>
) => {
	if (preferredSeasonId) {
		const preferred = await ctx.db.get(preferredSeasonId);
		if (preferred) return preferred;
	}
	const seasons = await ctx.db.query('seasons').collect();
	if (seasons.length === 0) return null;
	const now = Date.now();
	return (
		seasons.find((season) => season.reviewWindowOpen <= now && now <= season.reviewWindowClose) ??
		seasons.reduce((latest, season) =>
			season.reviewWindowOpen > latest.reviewWindowOpen ? season : latest
		)
	);
};

const isSeasonReviewWindowOpen = (season: Doc<'seasons'>, now: number) =>
	season.reviewWindowOpen <= now && now <= season.reviewWindowClose;

// The season whose review window currently contains `now`, or null.
export const getOpenReviewWindowSeason = async (ctx: QueryCtx | MutationCtx, now: number) => {
	const seasons = await ctx.db.query('seasons').collect();
	return seasons.find((season) => isSeasonReviewWindowOpen(season, now)) ?? null;
};

// Every season whose review window contains `now` (normally zero or one; windows may overlap).
const listOpenReviewWindowSeasons = async (ctx: QueryCtx | MutationCtx, now: number) => {
	const seasons = await ctx.db.query('seasons').collect();
	return seasons.filter((season) => isSeasonReviewWindowOpen(season, now));
};

// CL-778 (the original CL-765 ask): whether Guides are asked to score THIS application right now —
// true only while its own review season's window is open. No review season (not submitted, or a
// pre-CL-778 row the backfill could not place) counts as closed.
export const isApplicationReviewWindowOpen = async (
	ctx: QueryCtx | MutationCtx,
	application: Doc<'clubApplications'>,
	now = Date.now()
) => {
	if (!application.reviewSeasonId) return false;
	const season = await ctx.db.get(application.reviewSeasonId);
	return Boolean(season && isSeasonReviewWindowOpen(season, now));
};

// Whether Guides are currently being asked to score applications: true only while some season's
// review window contains `now`. The member app hides the scoring form outside a window (Ron,
// 2026-09-03: "we are past the 2 weeks since the opening of the reviewal period" — not asking
// Guides for scores right now). Nothing to flip when the next season starts: create the season
// with its review window on the admin Seasons tab and scoring reappears on its own.
//
// CL-778: the scoring form and the review list's call to action now follow each application's
// own review season (isApplicationReviewWindowOpen; getApplication / listReviewableApplications
// return a per-application `reviewWindowOpen`). This platform-wide flag and getReviewWindowState
// stay for member-app builds from before CL-778.
export const isReviewWindowOpen = async (ctx: QueryCtx | MutationCtx, now = Date.now()) =>
	Boolean(await getOpenReviewWindowSeason(ctx, now));

export const getReviewWindowState = query({
	args: {},
	returns: v.object({ open: v.boolean() }),
	handler: async (ctx) => {
		await requireIdentity(ctx);
		return { open: await isReviewWindowOpen(ctx) };
	}
});

// Eligible reviewer pool: active (non-left) Guide-role membership in a non-abandoned club. A
// Guide is only counted once even if they Guide multiple clubs. The applicant exclusion happens
// per-application (in-memory) in `assignReviewersForApplication` rather than here, so this whole
// pool is computed once per assignment run instead of once per pending application — previously
// this also did a non-indexed `.filter()` over the entire clubMembers table (convex_rules.txt);
// it now uses the `by_role` index.
const listEligibleGuideProfileIds = async (ctx: MutationCtx): Promise<Id<'profiles'>[]> => {
	const guideRole = await ctx.db
		.query('clubRoles')
		.withIndex('by_key', (q) => q.eq('key', 'guide'))
		.unique();
	if (!guideRole) return [];

	const memberships = await ctx.db
		.query('clubMembers')
		.withIndex('by_role', (q) => q.eq('roleId', guideRole._id))
		.collect();
	const activeMemberships = memberships.filter((membership) => !membership.leftAt);

	// Independent club lookups, deduped and batched instead of a sequential get per membership.
	const clubIds = [...new Set(activeMemberships.map((membership) => membership.clubId))];
	const clubEntries = await Promise.all(clubIds.map((clubId) => ctx.db.get(clubId)));
	const clubById = new Map(clubEntries.map((club, index) => [clubIds[index], club]));

	const eligible = new Set<Id<'profiles'>>();
	for (const membership of activeMemberships) {
		const club = clubById.get(membership.clubId);
		if (!club || club.abandonedAt) continue;
		eligible.add(membership.profileId);
	}
	return [...eligible];
};

const countAssignmentsThisSeason = async (
	ctx: MutationCtx,
	reviewerProfileId: Id<'profiles'>,
	seasonId: Id<'seasons'>
) => {
	const rows = await ctx.db
		.query('applicationReviewAssignments')
		.withIndex('by_reviewer_profile_id_and_season_id', (q) =>
			q.eq('reviewerProfileId', reviewerProfileId).eq('seasonId', seasonId)
		)
		.collect();
	return rows.length;
};

// CL-778: moving an application to another review season must not re-score it (Ron: an applicant
// who missed her interview is considered next season — interviewed and decided, no new scoring).
// An application has review history outside `seasonId` when a reviewer was booked against a
// different season, or a Guide reviewed it without an assignment in this season (pre-CL-709
// self-select reviews). Topping up within the same season (e.g. too few Guides on day one) still
// works: those assignments are all booked against this season.
const hasReviewHistoryOutsideSeason = async (
	ctx: MutationCtx,
	applicationId: Id<'clubApplications'>,
	assignments: Doc<'applicationReviewAssignments'>[],
	seasonId: Id<'seasons'>
) => {
	if (assignments.some((assignment) => assignment.seasonId !== seasonId)) return true;
	const assignedThisSeason = new Set(assignments.map((assignment) => assignment.reviewerProfileId));
	const reviews = await ctx.db
		.query('applicationReviews')
		.withIndex('by_application_id', (q) => q.eq('applicationId', applicationId))
		.collect();
	return reviews.some((review) => !assignedThisSeason.has(review.reviewerProfileId));
};

// Assigns one pending application to as many additional eligible Guides as needed to reach
// `reviewersPerApplication`, choosing the eligible Guide(s) with the fewest assignments this
// season (ties broken by profile id), skipping anyone already at the per-guide cap. Safe to call
// repeatedly / concurrently for the same application: existing assignment rows are respected via
// the unique (applicationId, reviewerProfileId) index, and it only ever tops up to the target.
const assignReviewersForApplication = async (
	ctx: MutationCtx,
	application: Doc<'clubApplications'>,
	seasonId: Id<'seasons'>,
	reviewersPerApplication: number,
	maxReviewsPerGuidePerSeason: number,
	eligibleGuideProfileIds: Id<'profiles'>[]
) => {
	const existingAssignments = await ctx.db
		.query('applicationReviewAssignments')
		.withIndex('by_application_id', (q) => q.eq('applicationId', application._id))
		.collect();
	if (await hasReviewHistoryOutsideSeason(ctx, application._id, existingAssignments, seasonId)) {
		return 0;
	}
	const alreadyAssigned = new Set(existingAssignments.map((row) => row.reviewerProfileId));
	const needed = reviewersPerApplication - alreadyAssigned.size;
	if (needed <= 0) return 0;

	const candidates = eligibleGuideProfileIds.filter(
		(profileId) => profileId !== application.applicantProfileId && !alreadyAssigned.has(profileId)
	);

	const loads = await Promise.all(
		candidates.map(async (profileId) => ({
			profileId,
			count: await countAssignmentsThisSeason(ctx, profileId, seasonId)
		}))
	);
	const underCap = loads.filter((row) => row.count < maxReviewsPerGuidePerSeason);
	underCap.sort((a, b) => a.count - b.count || (a.profileId > b.profileId ? 1 : -1));

	const chosen = underCap.slice(0, needed);
	const now = Date.now();
	for (const { profileId } of chosen) {
		await ctx.db.insert('applicationReviewAssignments', {
			applicationId: application._id,
			reviewerProfileId: profileId,
			seasonId,
			assignedAt: now
		});
	}
	return chosen.length;
};

// Distributes every pending, under-assigned application to eligible Guides for each season whose
// review window currently contains `now` (there should be at most one at a time in practice, but
// nothing stops overlapping windows — each is processed independently). No-op (returns zero
// counts) when no window is currently open. Called by the daily cron.
//
// CL-778: only applications whose `reviewSeasonId` is that season are assigned (read through the
// by_review_season_id_and_status index). A pending application without a review season is never
// assigned — the backfill sets it on existing rows right after deploy, and an admin can set it on
// anything left. `seasonId` is the first open season (kept for the cron log and older callers);
// `seasonIds` lists every season processed.
export const assignReviewsForOpenWindow = internalMutation({
	args: {},
	returns: v.object({
		seasonId: v.union(v.id('seasons'), v.null()),
		seasonIds: v.array(v.id('seasons')),
		applicationsProcessed: v.number(),
		assignmentsCreated: v.number()
	}),
	handler: async (ctx) => {
		const now = Date.now();
		const seasons = await listOpenReviewWindowSeasons(ctx, now);
		if (seasons.length === 0) {
			return { seasonId: null, seasonIds: [], applicationsProcessed: 0, assignmentsCreated: 0 };
		}

		const { reviewersPerApplication, maxReviewsPerGuidePerSeason } = await getReviewSettings(ctx);

		// Computed once for the whole run — every pending application shares the same eligible
		// pool (applicant exclusion happens per-application, in-memory), so this no longer
		// recomputes the full Guide/club scan once per application.
		const eligibleGuideProfileIds = await listEligibleGuideProfileIds(ctx);

		let applicationsProcessed = 0;
		let assignmentsCreated = 0;
		for (const season of seasons) {
			const pendingApplications = await ctx.db
				.query('clubApplications')
				.withIndex('by_review_season_id_and_status', (q) =>
					q.eq('reviewSeasonId', season._id).eq('status', 'pending')
				)
				.collect();
			// Oldest first, as before (the by_status_and_created_at scan) — earlier applicants get
			// the least-loaded Guides when the per-guide cap runs out.
			pendingApplications.sort((a, b) => a.createdAt - b.createdAt);
			for (const application of pendingApplications) {
				const created = await assignReviewersForApplication(
					ctx,
					application,
					season._id,
					reviewersPerApplication,
					maxReviewsPerGuidePerSeason,
					eligibleGuideProfileIds
				);
				if (created > 0) {
					applicationsProcessed += 1;
					assignmentsCreated += created;
				}
			}
		}

		return {
			seasonId: seasons[0]._id,
			seasonIds: seasons.map((season) => season._id),
			applicationsProcessed,
			assignmentsCreated
		};
	}
});

// Inline trigger for a single application (PRD 6.9.2 point 3: rolling distribution during the
// window) — called on submit and when an admin sets an application's review season. No-op unless
// the application is pending and its OWN review season's window is open (CL-778), or if it's
// already fully assigned / has review history in another season.
//
// CL-778 note: since a submission's review season is the intake season (whose deadline is still
// ahead, and scoring opens at the deadline), a fresh submission is normally NOT assigned on the
// spot any more; it waits for its season's window. The call stays for windows that open before
// the deadline (seasons from raw-timestamp tooling) and for admin season moves.
export const assignReviewsForApplicationIfWindowOpen = async (
	ctx: MutationCtx,
	applicationId: Id<'clubApplications'>
) => {
	const now = Date.now();
	const application = await ctx.db.get(applicationId);
	if (!application || application.status !== 'pending' || !application.reviewSeasonId) return;
	const season = await ctx.db.get(application.reviewSeasonId);
	if (!season || !isSeasonReviewWindowOpen(season, now)) return;

	const { reviewersPerApplication, maxReviewsPerGuidePerSeason } = await getReviewSettings(ctx);
	const eligibleGuideProfileIds = await listEligibleGuideProfileIds(ctx);
	await assignReviewersForApplication(
		ctx,
		application,
		season._id,
		reviewersPerApplication,
		maxReviewsPerGuidePerSeason,
		eligibleGuideProfileIds
	);
};

// One-off backfill migration (CL-709): pre-existing applicationReviews rows predate the dual
// principlesScore/safetyScore fields. Every existing row's single `score` becomes both dimensions
// (the closest honest interpretation available — there's no way to recover what the original
// reviewer would have split it into). Run once via
// `npx convex run reviewAssignmentModel:backfillDualScores` after deploying the schema change,
// then this can be deleted (mirrors the clubs.backfillClubKind precedent).
export const backfillDualScores = internalMutation({
	args: {},
	returns: v.object({ updated: v.number(), total: v.number() }),
	handler: async (ctx) => {
		const reviews = await ctx.db.query('applicationReviews').collect();
		let updated = 0;
		for (const review of reviews) {
			if (review.principlesScore !== undefined && review.safetyScore !== undefined) continue;
			await ctx.db.patch(review._id, {
				principlesScore: review.score,
				safetyScore: review.score
			});
			updated += 1;
		}
		return { updated, total: reviews.length };
	}
});

// Discrepancy escalation (PRD 6.9.2/6.13): when a review lands and the application now has >= 2
// reviews with a max-min `score` spread >= 4, alert the Core Team via the Google Chat webhook
// (googleChat.ts's established pattern). Admins have no notification-recipient concept in this
// app, so this is the only alert path; CL-732's dashboard flag (admin.ts adminApplicationsPipeline)
// independently recomputes the same condition for display. No auto-decision is made either way.
export const maybeNotifyScoreDiscrepancy = async (
	ctx: MutationCtx,
	applicationId: Id<'clubApplications'>
) => {
	const reviews = await ctx.db
		.query('applicationReviews')
		.withIndex('by_application_id', (q) => q.eq('applicationId', applicationId))
		.collect();
	if (reviews.length < 2) return;

	const scores = reviews.map((review) => review.score);
	const spread = Math.max(...scores) - Math.min(...scores);
	if (spread < 4) return;

	const application = await ctx.db.get(applicationId);
	await ctx.scheduler.runAfter(0, internal.googleChat.notifyApplicationScoreDiscrepancy, {
		applicationId,
		applicationName: application?.name ?? 'Unknown application',
		reviewCount: reviews.length,
		minScore: Math.min(...scores),
		maxScore: Math.max(...scores)
	});
};
