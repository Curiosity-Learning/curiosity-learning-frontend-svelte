import { ConvexError, v } from 'convex/values';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { internalMutation, mutation, query } from './_generated/server';
import { requireGlobalAdmin } from './permissions';

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
// *is* "pending with zero assignments". If a window is open but there are genuinely no eligible
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

// The season whose review window currently contains `now`, or null.
const getOpenReviewWindowSeason = async (ctx: MutationCtx, now: number) => {
	const seasons = await ctx.db.query('seasons').collect();
	return (
		seasons.find((season) => season.reviewWindowOpen <= now && now <= season.reviewWindowClose) ??
		null
	);
};

// Eligible reviewer: active (non-left) Guide-role membership in a non-abandoned club, and not
// the applicant. A Guide is only counted once even if they Guide multiple clubs.
const listEligibleReviewerProfileIds = async (
	ctx: MutationCtx,
	applicantProfileId: Id<'profiles'>
): Promise<Id<'profiles'>[]> => {
	const guideRole = await ctx.db
		.query('clubRoles')
		.withIndex('by_key', (q) => q.eq('key', 'guide'))
		.unique();
	if (!guideRole) return [];

	const memberships = await ctx.db
		.query('clubMembers')
		.filter((q) => q.eq(q.field('roleId'), guideRole._id))
		.collect();

	const eligible = new Set<Id<'profiles'>>();
	const clubCache = new Map<Id<'clubs'>, Doc<'clubs'> | null>();
	for (const membership of memberships) {
		if (membership.leftAt) continue;
		if (membership.profileId === applicantProfileId) continue;
		let club = clubCache.get(membership.clubId);
		if (club === undefined) {
			club = await ctx.db.get(membership.clubId);
			clubCache.set(membership.clubId, club);
		}
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
	maxReviewsPerGuidePerSeason: number
) => {
	const existingAssignments = await ctx.db
		.query('applicationReviewAssignments')
		.withIndex('by_application_id', (q) => q.eq('applicationId', application._id))
		.collect();
	const alreadyAssigned = new Set(existingAssignments.map((row) => row.reviewerProfileId));
	const needed = reviewersPerApplication - alreadyAssigned.size;
	if (needed <= 0) return 0;

	const eligibleProfileIds = await listEligibleReviewerProfileIds(
		ctx,
		application.applicantProfileId
	);
	const candidates = eligibleProfileIds.filter((profileId) => !alreadyAssigned.has(profileId));

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

// Distributes every pending, under-assigned application to eligible Guides for whichever
// season's review window currently contains `now` (there should be at most one at a time in
// practice, but nothing stops overlapping windows — each is processed independently). No-op
// (returns zero counts) when no window is currently open. Called by the daily cron and inline
// from submitApplication (mid-window rolling distribution, PRD 6.9.2 point 3).
export const assignReviewsForOpenWindow = internalMutation({
	args: {},
	returns: v.object({
		seasonId: v.union(v.id('seasons'), v.null()),
		applicationsProcessed: v.number(),
		assignmentsCreated: v.number()
	}),
	handler: async (ctx) => {
		const now = Date.now();
		const season = await getOpenReviewWindowSeason(ctx, now);
		if (!season) {
			return { seasonId: null, applicationsProcessed: 0, assignmentsCreated: 0 };
		}

		const { reviewersPerApplication, maxReviewsPerGuidePerSeason } = await getReviewSettings(ctx);

		const pendingApplications = await ctx.db
			.query('clubApplications')
			.withIndex('by_status_and_created_at', (q) => q.eq('status', 'pending'))
			.collect();

		let applicationsProcessed = 0;
		let assignmentsCreated = 0;
		for (const application of pendingApplications) {
			const created = await assignReviewersForApplication(
				ctx,
				application,
				season._id,
				reviewersPerApplication,
				maxReviewsPerGuidePerSeason
			);
			if (created > 0) {
				applicationsProcessed += 1;
				assignmentsCreated += created;
			}
		}

		return { seasonId: season._id, applicationsProcessed, assignmentsCreated };
	}
});

// Inline trigger for a single just-submitted application (PRD 6.9.2 point 3: rolling
// distribution during the window). No-op if no window is currently open for this application's
// submission time, or if it's already fully assigned.
export const assignReviewsForApplicationIfWindowOpen = async (
	ctx: MutationCtx,
	applicationId: Id<'clubApplications'>
) => {
	const now = Date.now();
	const season = await getOpenReviewWindowSeason(ctx, now);
	if (!season) return;

	const application = await ctx.db.get(applicationId);
	if (!application || application.status !== 'pending') return;

	const { reviewersPerApplication, maxReviewsPerGuidePerSeason } = await getReviewSettings(ctx);
	await assignReviewersForApplication(
		ctx,
		application,
		season._id,
		reviewersPerApplication,
		maxReviewsPerGuidePerSeason
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
