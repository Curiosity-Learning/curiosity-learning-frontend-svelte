/// <reference types="vite/client" />

import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

const DAY = 24 * 60 * 60 * 1000;

const seedRoles = async (t: ReturnType<typeof convexTest>) => {
	return await t.run(async (ctx) => {
		const now = Date.now();
		const guideRoleId = await ctx.db.insert('clubRoles', {
			key: 'guide',
			name: 'Guide',
			permissions: ['club:read'],
			order: 0,
			createdAt: now
		});
		const learnerRoleId = await ctx.db.insert('clubRoles', {
			key: 'learner',
			name: 'Learner',
			permissions: ['club:read'],
			order: 1,
			createdAt: now
		});
		return { guideRoleId, learnerRoleId };
	});
};

const seedProfile = async (t: ReturnType<typeof convexTest>, authUserId: string) => {
	return await t.run(async (ctx) => {
		return await ctx.db.insert('profiles', {
			authUserId,
			username: authUserId,
			isVerified: true,
			firstLoginCompleted: true,
			updatedAt: Date.now()
		});
	});
};

const seedGuideClub = async (
	t: ReturnType<typeof convexTest>,
	guideProfileId: Id<'profiles'>,
	guideRoleId: Id<'clubRoles'>,
	overrides: { abandonedAt?: number } = {}
) => {
	return await t.run(async (ctx) => {
		const now = Date.now();
		const clubId = await ctx.db.insert('clubs', {
			name: 'Guide Club',
			discoverable: false,
			createdByProfileId: guideProfileId,
			abandonedAt: overrides.abandonedAt,
			createdAt: now,
			updatedAt: now
		});
		await ctx.db.insert('clubMembers', {
			clubId,
			profileId: guideProfileId,
			roleId: guideRoleId,
			createdAt: now
		});
		return clubId;
	});
};

const seedApplication = async (
	t: ReturnType<typeof convexTest>,
	applicantProfileId: Id<'profiles'>,
	overrides: {
		status?: 'pending' | 'incomplete' | 'interview';
		createdAt?: number;
		reviewSeasonId?: Id<'seasons'>;
	} = {}
) => {
	return await t.run(async (ctx) => {
		const now = Date.now();
		return await ctx.db.insert('clubApplications', {
			applicantProfileId,
			status: overrides.status ?? 'pending',
			name: 'New Curiosity Club',
			reviewSeasonId: overrides.reviewSeasonId,
			createdAt: overrides.createdAt ?? now,
			updatedAt: now
		});
	});
};

const seedSeason = async (
	t: ReturnType<typeof convexTest>,
	overrides: Partial<{
		name: string;
		startDate: number;
		endDate: number;
		reviewWindowOpen: number;
		reviewWindowClose: number;
		feedbackDeadline: number;
	}> = {}
) => {
	const now = Date.now();
	return await t.mutation(internal.seasons.createSeason, {
		name: overrides.name ?? 'Test Season',
		startDate: overrides.startDate ?? now + 60 * DAY,
		endDate: overrides.endDate ?? now + 120 * DAY,
		reviewWindowOpen: overrides.reviewWindowOpen ?? now - 1 * DAY,
		reviewWindowClose: overrides.reviewWindowClose ?? now + 1 * DAY,
		feedbackDeadline: overrides.feedbackDeadline ?? now + 150 * DAY
	});
};

const seedAdmin = async (t: ReturnType<typeof convexTest>) => {
	const adminProfileId = await seedProfile(t, 'season-admin');
	await t.run((ctx) => ctx.db.patch(adminProfileId, { globalRole: 'admin' }));
	return t.withIdentity({ subject: 'season-admin' });
};

describe('assignReviewsForOpenWindow', () => {
	it('does nothing when no season has an open review window', async () => {
		const t = convexTest(schema, modules);
		const { guideRoleId } = await seedRoles(t);
		const guideProfileId = await seedProfile(t, 'guide-1');
		await seedGuideClub(t, guideProfileId, guideRoleId);
		const applicantProfileId = await seedProfile(t, 'applicant-1');
		await seedApplication(t, applicantProfileId);
		const now = Date.now();
		await seedSeason(t, {
			reviewWindowOpen: now - 10 * DAY,
			reviewWindowClose: now - 5 * DAY
		});

		const result = await t.mutation(internal.reviewAssignmentModel.assignReviewsForOpenWindow, {});
		expect(result.seasonId).toBeNull();
		expect(result.assignmentsCreated).toBe(0);

		const assignments = await t.run((ctx) =>
			ctx.db.query('applicationReviewAssignments').collect()
		);
		expect(assignments).toHaveLength(0);
	});

	it('assigns a pending application to eligible guides, excluding the applicant and learners', async () => {
		const t = convexTest(schema, modules);
		const { guideRoleId, learnerRoleId } = await seedRoles(t);

		const guideAProfileId = await seedProfile(t, 'guide-a');
		const guideBProfileId = await seedProfile(t, 'guide-b');
		const guideCProfileId = await seedProfile(t, 'guide-c');
		await seedGuideClub(t, guideAProfileId, guideRoleId);
		await seedGuideClub(t, guideBProfileId, guideRoleId);
		await seedGuideClub(t, guideCProfileId, guideRoleId);

		// A learner-only profile must never be picked as a reviewer.
		const learnerOnlyProfileId = await seedProfile(t, 'learner-only');
		const someClubId = await seedGuideClub(t, guideAProfileId, guideRoleId);
		await t.run((ctx) =>
			ctx.db.insert('clubMembers', {
				clubId: someClubId,
				profileId: learnerOnlyProfileId,
				roleId: learnerRoleId,
				createdAt: Date.now()
			})
		);

		// The applicant is also a guide elsewhere, but must never review their own application.
		const applicantProfileId = await seedProfile(t, 'applicant-guide');
		await seedGuideClub(t, applicantProfileId, guideRoleId);

		const seasonId = await seedSeason(t);
		const applicationId = await seedApplication(t, applicantProfileId, {
			reviewSeasonId: seasonId
		});

		const result = await t.mutation(internal.reviewAssignmentModel.assignReviewsForOpenWindow, {});
		expect(result.seasonId).toBe(seasonId);
		expect(result.applicationsProcessed).toBe(1);
		expect(result.assignmentsCreated).toBe(3);

		const assignments = await t.run((ctx) =>
			ctx.db
				.query('applicationReviewAssignments')
				.withIndex('by_application_id', (q) => q.eq('applicationId', applicationId))
				.collect()
		);
		expect(assignments).toHaveLength(3);
		const reviewerIds = assignments.map((a) => a.reviewerProfileId).sort();
		expect(reviewerIds).toEqual([guideAProfileId, guideBProfileId, guideCProfileId].sort());
		expect(reviewerIds).not.toContain(applicantProfileId);
		expect(reviewerIds).not.toContain(learnerOnlyProfileId);
	});

	it('excludes guides whose only membership is in an abandoned club', async () => {
		const t = convexTest(schema, modules);
		const { guideRoleId } = await seedRoles(t);
		const abandonedGuideProfileId = await seedProfile(t, 'abandoned-guide');
		await seedGuideClub(t, abandonedGuideProfileId, guideRoleId, { abandonedAt: Date.now() });

		const applicantProfileId = await seedProfile(t, 'applicant-2');
		await seedApplication(t, applicantProfileId);
		await seedSeason(t);

		const result = await t.mutation(internal.reviewAssignmentModel.assignReviewsForOpenWindow, {});
		expect(result.assignmentsCreated).toBe(0);
	});

	it('leaves applications queued (no assignments) when a window is open but there are no eligible guides', async () => {
		const t = convexTest(schema, modules);
		await seedRoles(t);
		const applicantProfileId = await seedProfile(t, 'applicant-3');
		const applicationId = await seedApplication(t, applicantProfileId);
		await seedSeason(t);

		const result = await t.mutation(internal.reviewAssignmentModel.assignReviewsForOpenWindow, {});
		expect(result.applicationsProcessed).toBe(0);
		expect(result.assignmentsCreated).toBe(0);

		const application = await t.run((ctx) => ctx.db.get(applicationId));
		expect(application?.status).toBe('pending');
	});

	it('balances load and enforces the per-guide-per-season cap', async () => {
		const t = convexTest(schema, modules);
		const { guideRoleId } = await seedRoles(t);

		// Two guides only: whatever reviewersPerApplication is, only 2 can ever be assigned per
		// application since there are only 2 eligible guides.
		const guideAProfileId = await seedProfile(t, 'guide-load-a');
		const guideBProfileId = await seedProfile(t, 'guide-load-b');
		await seedGuideClub(t, guideAProfileId, guideRoleId);
		await seedGuideClub(t, guideBProfileId, guideRoleId);

		await t.run((ctx) =>
			ctx.db.insert('reviewSettings', {
				reviewersPerApplication: 1,
				maxReviewsPerGuidePerSeason: 1,
				updatedAt: Date.now()
			})
		);

		const applicant1 = await seedProfile(t, 'applicant-load-1');
		const applicant2 = await seedProfile(t, 'applicant-load-2');
		const applicant3 = await seedProfile(t, 'applicant-load-3');
		const seasonId = await seedSeason(t);
		await seedApplication(t, applicant1, {
			createdAt: Date.now() - 3000,
			reviewSeasonId: seasonId
		});
		await seedApplication(t, applicant2, {
			createdAt: Date.now() - 2000,
			reviewSeasonId: seasonId
		});
		await seedApplication(t, applicant3, {
			createdAt: Date.now() - 1000,
			reviewSeasonId: seasonId
		});

		const result = await t.mutation(internal.reviewAssignmentModel.assignReviewsForOpenWindow, {});
		// Only 2 applications can get an assignment: 2 guides x cap of 1 review each = 2 total slots.
		expect(result.assignmentsCreated).toBe(2);

		const assignments = await t.run((ctx) =>
			ctx.db.query('applicationReviewAssignments').collect()
		);
		expect(assignments).toHaveLength(2);
		const reviewerCounts = new Map<string, number>();
		for (const assignment of assignments) {
			reviewerCounts.set(
				assignment.reviewerProfileId,
				(reviewerCounts.get(assignment.reviewerProfileId) ?? 0) + 1
			);
		}
		// Each guide got at most their cap (1) — load balancing spread the 2 available slots across
		// both guides rather than piling both onto one.
		for (const count of reviewerCounts.values()) {
			expect(count).toBeLessThanOrEqual(1);
		}
		expect(reviewerCounts.size).toBe(2);
	});

	it('is idempotent: running twice does not create duplicate assignments', async () => {
		const t = convexTest(schema, modules);
		const { guideRoleId } = await seedRoles(t);
		const guideProfileId = await seedProfile(t, 'guide-idempotent');
		await seedGuideClub(t, guideProfileId, guideRoleId);
		const applicantProfileId = await seedProfile(t, 'applicant-idempotent');
		const seasonId = await seedSeason(t);
		await seedApplication(t, applicantProfileId, { reviewSeasonId: seasonId });

		await t.mutation(internal.reviewAssignmentModel.assignReviewsForOpenWindow, {});
		const secondRun = await t.mutation(
			internal.reviewAssignmentModel.assignReviewsForOpenWindow,
			{}
		);
		expect(secondRun.assignmentsCreated).toBe(0);

		const assignments = await t.run((ctx) =>
			ctx.db.query('applicationReviewAssignments').collect()
		);
		expect(assignments).toHaveLength(1);
	});
});

const seedReadyVideo = async (t: ReturnType<typeof convexTest>, ownerUserId: string) => {
	return await t.run(async (ctx) => {
		const now = Date.now();
		return await ctx.db.insert('mediaAssets', {
			ownerUserId,
			mediaKind: 'video',
			status: 'ready',
			acceptedContentTypes: ['video/mp4'],
			maxBytes: 100_000_000,
			enableCompression: true,
			enableSafetyScreening: true,
			storageProvider: 's3',
			sourceBucket: 'test-bucket',
			sourceObjectKey: `test-object-key-${ownerUserId}`,
			sourceObjectRevision: 1,
			contentType: 'video/mp4',
			sizeBytes: 1000,
			pipelineVersion: 1,
			attemptCount: 1,
			stepResults: [],
			createdAt: now,
			updatedAt: now,
			readyAt: now
		});
	});
};

// CL-778: a season as the admin form creates it — scoring opens when applications close.
const seedIntakeSeason = async (
	t: ReturnType<typeof convexTest>,
	name: string,
	applicationDeadline: number
) => {
	return await t.mutation(internal.seasons.createSeason, {
		name,
		applicationDeadline,
		reviewWindowOpen: applicationDeadline,
		reviewWindowClose: applicationDeadline + 14 * DAY,
		startDate: applicationDeadline + 30 * DAY,
		endDate: applicationDeadline + 120 * DAY,
		feedbackDeadline: applicationDeadline + 150 * DAY
	});
};

// Typed against the schema, so helpers taking it get typed table queries.
const createTest = () => convexTest(schema, modules);

const getApplicationOf = async (
	t: ReturnType<typeof createTest>,
	applicantProfileId: Id<'profiles'>
) =>
	await t.run((ctx) =>
		ctx.db
			.query('clubApplications')
			.withIndex('by_applicant_profile_id', (q) => q.eq('applicantProfileId', applicantProfileId))
			.first()
	);

describe('submitApplication season linking (CL-778)', () => {
	it('a submission after a season deadline goes to the next season and is not scored in the open window', async () => {
		const t = createTest();
		const { guideRoleId } = await seedRoles(t);
		const guideProfileId = await seedProfile(t, 'guide-rolling');
		await seedGuideClub(t, guideProfileId, guideRoleId);
		const now = Date.now();
		// Winter's applications closed yesterday, so its scoring window is open right now.
		const winterId = await seedIntakeSeason(t, 'Winter 2026', now - DAY);
		const springId = await seedIntakeSeason(t, 'Spring 2027', now + 90 * DAY);

		const applicantProfileId = await seedProfile(t, 'applicant-rolling');
		const videoMediaAssetId = await seedReadyVideo(t, 'applicant-rolling');
		await t
			.withIdentity({ subject: 'applicant-rolling' })
			.mutation(api.clubApplications.submitApplication, {
				name: 'Rolling Club',
				videoMediaAssetId
			});

		const application = await getApplicationOf(t, applicantProfileId);
		expect(application?.status).toBe('pending');
		expect(application?.reviewSeasonId).toBe(springId);
		expect(application?.startedSeasonId).toBe(springId);
		expect(application?.submittedAt).toEqual(expect.any(Number));

		// Neither on submit nor in the cron: Winter's open window is not this application's season.
		const result = await t.mutation(internal.reviewAssignmentModel.assignReviewsForOpenWindow, {});
		expect(result.seasonIds).toEqual([winterId]);
		const assignments = await t.run((ctx) =>
			ctx.db.query('applicationReviewAssignments').collect()
		);
		expect(assignments).toHaveLength(0);

		await t.finishAllScheduledFunctions(() => Promise.resolve());
	});

	it('keeps the started season of the draft and sets the review season on submit', async () => {
		const t = createTest();
		const now = Date.now();
		const winterId = await seedIntakeSeason(t, 'Winter 2026', now + DAY);

		const applicantProfileId = await seedProfile(t, 'applicant-draft');
		await t
			.withIdentity({ subject: 'applicant-draft' })
			.mutation(api.clubApplications.saveIncompleteApplication, { location: 'Utrecht' });
		const draft = await getApplicationOf(t, applicantProfileId);
		expect(draft?.status).toBe('incomplete');
		expect(draft?.startedSeasonId).toBe(winterId);
		expect(draft?.reviewSeasonId).toBeUndefined();
		expect(draft?.submittedAt).toBeUndefined();

		// Winter closes; the applicant finishes later, during Spring's intake.
		const springId = await seedIntakeSeason(t, 'Spring 2027', now + 90 * DAY);
		await t.run((ctx) => ctx.db.patch(winterId, { applicationDeadline: now - DAY }));

		const videoMediaAssetId = await seedReadyVideo(t, 'applicant-draft');
		await t
			.withIdentity({ subject: 'applicant-draft' })
			.mutation(api.clubApplications.submitApplication, {
				name: 'Utrecht Curiosity Club',
				videoMediaAssetId
			});

		const submitted = await t.run((ctx) => ctx.db.get(draft!._id));
		expect(submitted?.status).toBe('pending');
		expect(submitted?.startedSeasonId).toBe(winterId);
		expect(submitted?.reviewSeasonId).toBe(springId);
		expect(submitted?.submittedAt).toEqual(expect.any(Number));

		await t.finishAllScheduledFunctions(() => Promise.resolve());
	});

	it('leaves both seasons unset (no throw) when no season takes applications', async () => {
		const t = createTest();
		const applicantProfileId = await seedProfile(t, 'applicant-no-season');
		const videoMediaAssetId = await seedReadyVideo(t, 'applicant-no-season');
		await t
			.withIdentity({ subject: 'applicant-no-season' })
			.mutation(api.clubApplications.submitApplication, {
				name: 'No Season Club',
				videoMediaAssetId
			});
		const application = await getApplicationOf(t, applicantProfileId);
		expect(application?.status).toBe('pending');
		expect(application?.startedSeasonId).toBeUndefined();
		expect(application?.reviewSeasonId).toBeUndefined();

		await t.finishAllScheduledFunctions(() => Promise.resolve());
	});
});

describe('season-scoped assignment (CL-778)', () => {
	it('only assigns applications whose review season is the open-window season', async () => {
		const t = convexTest(schema, modules);
		const { guideRoleId } = await seedRoles(t);
		const guideProfileId = await seedProfile(t, 'guide-scoped');
		await seedGuideClub(t, guideProfileId, guideRoleId);
		const now = Date.now();
		const openSeasonId = await seedSeason(t, { name: 'Open' });
		const laterSeasonId = await seedSeason(t, {
			name: 'Later',
			reviewWindowOpen: now + 80 * DAY,
			reviewWindowClose: now + 90 * DAY
		});

		const inSeason = await seedApplication(t, await seedProfile(t, 'applicant-in'), {
			reviewSeasonId: openSeasonId
		});
		const nextSeason = await seedApplication(t, await seedProfile(t, 'applicant-next'), {
			reviewSeasonId: laterSeasonId
		});
		// No review season: not assigned until the backfill or an admin sets one.
		const noSeason = await seedApplication(t, await seedProfile(t, 'applicant-none'));

		const result = await t.mutation(internal.reviewAssignmentModel.assignReviewsForOpenWindow, {});
		expect(result.seasonId).toBe(openSeasonId);
		expect(result.applicationsProcessed).toBe(1);

		const assignments = await t.run((ctx) =>
			ctx.db.query('applicationReviewAssignments').collect()
		);
		expect(assignments.map((a) => a.applicationId)).toEqual([inSeason]);
		expect(assignments[0].seasonId).toBe(openSeasonId);
		expect(assignments.some((a) => a.applicationId === nextSeason)).toBe(false);
		expect(assignments.some((a) => a.applicationId === noSeason)).toBe(false);
	});

	it('does not give a moved, already-reviewed pending application new reviewers', async () => {
		const t = convexTest(schema, modules);
		const { guideRoleId } = await seedRoles(t);
		const oldGuideProfileId = await seedProfile(t, 'guide-old');
		const newGuideProfileId = await seedProfile(t, 'guide-new');
		await seedGuideClub(t, oldGuideProfileId, guideRoleId);
		await seedGuideClub(t, newGuideProfileId, guideRoleId);
		const now = Date.now();
		const pastSeasonId = await seedSeason(t, {
			name: 'Past',
			reviewWindowOpen: now - 100 * DAY,
			reviewWindowClose: now - 90 * DAY
		});
		const openSeasonId = await seedSeason(t, { name: 'Open' });

		// Scored in the past season, then moved by an admin to the open season while still pending.
		const applicationId = await seedApplication(t, await seedProfile(t, 'applicant-moved'), {
			reviewSeasonId: pastSeasonId
		});
		await t.run(async (ctx) => {
			await ctx.db.insert('applicationReviewAssignments', {
				applicationId,
				reviewerProfileId: oldGuideProfileId,
				seasonId: pastSeasonId,
				assignedAt: now - 95 * DAY
			});
			await ctx.db.insert('applicationReviews', {
				applicationId,
				reviewerProfileId: oldGuideProfileId,
				principlesScore: 8,
				safetyScore: 8,
				score: 8,
				note: 'Scored last season',
				createdAt: now - 95 * DAY,
				updatedAt: now - 95 * DAY
			});
		});
		const admin = await seedAdmin(t);
		await admin.mutation(api.admin.adminSetApplicationReviewSeason, {
			applicationId,
			seasonId: openSeasonId
		});

		const result = await t.mutation(internal.reviewAssignmentModel.assignReviewsForOpenWindow, {});
		expect(result.assignmentsCreated).toBe(0);
		const application = await t.run((ctx) => ctx.db.get(applicationId));
		expect(application?.reviewSeasonId).toBe(openSeasonId);
		expect(application?.status).toBe('pending');
		const assignments = await t.run((ctx) =>
			ctx.db.query('applicationReviewAssignments').collect()
		);
		expect(assignments).toHaveLength(1);
		const reviews = await t.run((ctx) => ctx.db.query('applicationReviews').collect());
		expect(reviews).toHaveLength(1);
	});

	it('still gives a moved application with only an unscored assignment in another season reviewers', async () => {
		const t = convexTest(schema, modules);
		const { guideRoleId } = await seedRoles(t);
		const oldGuideProfileId = await seedProfile(t, 'guide-unscored-old');
		const newGuideProfileId = await seedProfile(t, 'guide-unscored-new');
		await seedGuideClub(t, oldGuideProfileId, guideRoleId);
		await seedGuideClub(t, newGuideProfileId, guideRoleId);
		const now = Date.now();
		// Like prod: an early assignment booked against the bootstrap season, never scored.
		const bootstrapSeasonId = await seedSeason(t, {
			name: 'Season 0',
			reviewWindowOpen: now - 100 * DAY,
			reviewWindowClose: now - 90 * DAY
		});
		const openSeasonId = await seedSeason(t, { name: 'Open' });
		const applicationId = await seedApplication(t, await seedProfile(t, 'applicant-unscored'), {
			reviewSeasonId: bootstrapSeasonId
		});
		await t.run((ctx) =>
			ctx.db.insert('applicationReviewAssignments', {
				applicationId,
				reviewerProfileId: oldGuideProfileId,
				seasonId: bootstrapSeasonId,
				assignedAt: now - 95 * DAY
			})
		);

		const admin = await seedAdmin(t);
		await admin.mutation(api.admin.adminSetApplicationReviewSeason, {
			applicationId,
			seasonId: openSeasonId
		});
		await t.mutation(internal.reviewAssignmentModel.assignReviewsForOpenWindow, {});

		const assignments = await t.run((ctx) =>
			ctx.db
				.query('applicationReviewAssignments')
				.withIndex('by_application_id', (q) => q.eq('applicationId', applicationId))
				.collect()
		);
		expect(assignments).toHaveLength(2);
		const added = assignments.find((a) => a.reviewerProfileId === newGuideProfileId);
		expect(added?.seasonId).toBe(openSeasonId);
	});

	it('tops up a pending application in the open season even when its old assignments were booked against another season', async () => {
		const t = convexTest(schema, modules);
		const { guideRoleId } = await seedRoles(t);
		const oldGuideProfileId = await seedProfile(t, 'guide-topup-old');
		const newGuideProfileId = await seedProfile(t, 'guide-topup-new');
		await seedGuideClub(t, oldGuideProfileId, guideRoleId);
		await seedGuideClub(t, newGuideProfileId, guideRoleId);
		const now = Date.now();
		const bootstrapSeasonId = await seedSeason(t, {
			name: 'Season 0',
			reviewWindowOpen: now - 100 * DAY,
			reviewWindowClose: now - 90 * DAY
		});
		const openSeasonId = await seedSeason(t, { name: 'Open' });
		const applicationId = await seedApplication(t, await seedProfile(t, 'applicant-topup'), {
			reviewSeasonId: openSeasonId
		});
		await t.run((ctx) =>
			ctx.db.insert('applicationReviewAssignments', {
				applicationId,
				reviewerProfileId: oldGuideProfileId,
				seasonId: bootstrapSeasonId,
				assignedAt: now - 95 * DAY
			})
		);

		const result = await t.mutation(internal.reviewAssignmentModel.assignReviewsForOpenWindow, {});
		expect(result.assignmentsCreated).toBe(1);
	});

	it('assigns a never-reviewed pending application right away when an admin moves it into the open season', async () => {
		const t = convexTest(schema, modules);
		const { guideRoleId } = await seedRoles(t);
		const guideProfileId = await seedProfile(t, 'guide-move-in');
		await seedGuideClub(t, guideProfileId, guideRoleId);
		const openSeasonId = await seedSeason(t, { name: 'Open' });
		const applicationId = await seedApplication(t, await seedProfile(t, 'applicant-move-in'));

		const admin = await seedAdmin(t);
		await admin.mutation(api.admin.adminSetApplicationReviewSeason, {
			applicationId,
			seasonId: openSeasonId
		});

		const assignments = await t.run((ctx) =>
			ctx.db
				.query('applicationReviewAssignments')
				.withIndex('by_application_id', (q) => q.eq('applicationId', applicationId))
				.collect()
		);
		expect(assignments.map((a) => a.reviewerProfileId)).toEqual([guideProfileId]);
		expect(assignments[0].seasonId).toBe(openSeasonId);
	});

	it('never assigns interview-stage applications, even in their own open season', async () => {
		const t = convexTest(schema, modules);
		const { guideRoleId } = await seedRoles(t);
		await seedGuideClub(t, await seedProfile(t, 'guide-interview'), guideRoleId);
		const openSeasonId = await seedSeason(t, { name: 'Open' });
		await seedApplication(t, await seedProfile(t, 'applicant-interview'), {
			status: 'interview',
			reviewSeasonId: openSeasonId
		});

		const result = await t.mutation(internal.reviewAssignmentModel.assignReviewsForOpenWindow, {});
		expect(result.assignmentsCreated).toBe(0);
	});
});

describe('adminSetApplicationReviewSeason (CL-778)', () => {
	it('is admin-only and only for submitted applications', async () => {
		const t = convexTest(schema, modules);
		const { guideRoleId } = await seedRoles(t);
		const guideProfileId = await seedProfile(t, 'guide-not-admin');
		await seedGuideClub(t, guideProfileId, guideRoleId);
		const seasonId = await seedSeason(t);
		const pendingId = await seedApplication(t, await seedProfile(t, 'applicant-edit'));
		const incompleteId = await seedApplication(t, await seedProfile(t, 'applicant-draft-edit'), {
			status: 'incomplete'
		});

		await expect(
			t
				.withIdentity({ subject: 'guide-not-admin' })
				.mutation(api.admin.adminSetApplicationReviewSeason, { applicationId: pendingId, seasonId })
		).rejects.toThrow('Not authorized');

		const admin = await seedAdmin(t);
		await expect(
			admin.mutation(api.admin.adminSetApplicationReviewSeason, {
				applicationId: incompleteId,
				seasonId
			})
		).rejects.toThrow('Only submitted applications have a season for review');

		await admin.mutation(api.admin.adminSetApplicationReviewSeason, {
			applicationId: pendingId,
			seasonId
		});
		const application = await t.run((ctx) => ctx.db.get(pendingId));
		expect(application?.reviewSeasonId).toBe(seasonId);
		expect(application?.startedSeasonId).toBeUndefined();
	});
});

describe('assignment-gated review flow', () => {
	it('only lists applications assigned to the current guide, and hides them once reviewed', async () => {
		const t = convexTest(schema, modules);
		const { guideRoleId } = await seedRoles(t);
		const assignedGuideProfileId = await seedProfile(t, 'assigned-guide');
		const unassignedGuideProfileId = await seedProfile(t, 'unassigned-guide');
		await seedGuideClub(t, assignedGuideProfileId, guideRoleId);
		await seedGuideClub(t, unassignedGuideProfileId, guideRoleId);

		const applicantProfileId = await seedProfile(t, 'applicant-gate');
		const seasonId = await seedSeason(t);
		const applicationId = await seedApplication(t, applicantProfileId, {
			reviewSeasonId: seasonId
		});
		await t.run((ctx) =>
			ctx.db.insert('applicationReviewAssignments', {
				applicationId,
				reviewerProfileId: assignedGuideProfileId,
				seasonId,
				assignedAt: Date.now()
			})
		);

		const assignedGuide = t.withIdentity({ subject: 'assigned-guide' });
		const unassignedGuide = t.withIdentity({ subject: 'unassigned-guide' });

		const assignedQueue = await assignedGuide.query(api.clubApplications.getMyReviewQueue, {});
		expect(assignedQueue.toReview).toHaveLength(1);
		const unassignedQueue = await unassignedGuide.query(api.clubApplications.getMyReviewQueue, {});
		expect(unassignedQueue.toReview).toHaveLength(0);
		// Nothing assigned this season → no "Reviews" entry point at all.
		expect(
			await unassignedGuide.query(api.clubApplications.countReviewableApplications, {})
		).toBeNull();

		const assignedCount = await assignedGuide.query(
			api.clubApplications.countReviewableApplications,
			{}
		);
		expect(assignedCount).toBe(1);

		await assignedGuide.mutation(api.clubApplications.upsertApplicationReview, {
			applicationId,
			alignmentScore: 4,
			motivationScore: 3,
			readinessScore: 3,
			note: 'Solid application'
		});

		// CL-780: a reviewed application moves to "Reviewed" (with the viewer's score) instead of
		// disappearing.
		const afterReviewQueue = await assignedGuide.query(api.clubApplications.getMyReviewQueue, {});
		expect(afterReviewQueue.toReview).toHaveLength(0);
		expect(afterReviewQueue.reviewed).toEqual([
			expect.objectContaining({ applicationId, myScore: 3.3 })
		]);
		const afterReviewCount = await assignedGuide.query(
			api.clubApplications.countReviewableApplications,
			{}
		);
		expect(afterReviewCount).toBe(0);

		const review = await t.run((ctx) =>
			ctx.db
				.query('applicationReviews')
				.withIndex('by_application_id_and_reviewer_profile_id', (q) =>
					q.eq('applicationId', applicationId).eq('reviewerProfileId', assignedGuideProfileId)
				)
				.unique()
		);
		expect(review?.alignmentScore).toBe(4);
		expect(review?.motivationScore).toBe(3);
		expect(review?.readinessScore).toBe(3);
		expect(review?.score).toBe(3.3);
	});

	it('rejects scores outside 1-5 and scoring outside the application’s review window (CL-780)', async () => {
		const t = convexTest(schema, modules);
		const { guideRoleId } = await seedRoles(t);
		const guideProfileId = await seedProfile(t, 'scale-guide');
		await seedGuideClub(t, guideProfileId, guideRoleId);
		const applicantProfileId = await seedProfile(t, 'applicant-scale');
		const openSeasonId = await seedSeason(t);
		const applicationId = await seedApplication(t, applicantProfileId, {
			reviewSeasonId: openSeasonId
		});
		await t.run((ctx) =>
			ctx.db.insert('applicationReviewAssignments', {
				applicationId,
				reviewerProfileId: guideProfileId,
				seasonId: openSeasonId,
				assignedAt: Date.now()
			})
		);
		const guide = t.withIdentity({ subject: 'scale-guide' });
		const scores = { alignmentScore: 3, motivationScore: 3, readinessScore: 3, note: '' };

		await expect(
			guide.mutation(api.clubApplications.upsertApplicationReview, {
				applicationId,
				...scores,
				alignmentScore: 0
			})
		).rejects.toThrow('Alignment must be a whole number from 1 to 5');
		await expect(
			guide.mutation(api.clubApplications.upsertApplicationReview, {
				applicationId,
				...scores,
				readinessScore: 6
			})
		).rejects.toThrow('Readiness must be a whole number from 1 to 5');

		// An empty "to clarify" note is fine.
		await guide.mutation(api.clubApplications.upsertApplicationReview, {
			applicationId,
			...scores
		});

		const now = Date.now();
		const closedSeasonId = await seedSeason(t, {
			name: 'Closed',
			reviewWindowOpen: now - 10 * DAY,
			reviewWindowClose: now - 5 * DAY
		});
		await t.run((ctx) => ctx.db.patch(applicationId, { reviewSeasonId: closedSeasonId }));
		await expect(
			guide.mutation(api.clubApplications.upsertApplicationReview, { applicationId, ...scores })
		).rejects.toThrow('Scoring for this application is closed');
	});

	it('rejects reviewing an application with no assignment and no existing review row', async () => {
		const t = convexTest(schema, modules);
		const { guideRoleId } = await seedRoles(t);
		const guideProfileId = await seedProfile(t, 'no-assignment-guide');
		await seedGuideClub(t, guideProfileId, guideRoleId);
		const applicantProfileId = await seedProfile(t, 'applicant-no-assignment');
		const seasonId = await seedSeason(t);
		const applicationId = await seedApplication(t, applicantProfileId, {
			reviewSeasonId: seasonId
		});

		await expect(
			t
				.withIdentity({ subject: 'no-assignment-guide' })
				.mutation(api.clubApplications.upsertApplicationReview, {
					applicationId,
					alignmentScore: 3,
					motivationScore: 3,
					readinessScore: 3,
					note: 'Note'
				})
		).rejects.toThrow('This application is not assigned to you');
	});

	it('lets a guide with a pre-existing review row keep editing it even without an assignment row (ops escape hatch)', async () => {
		const t = convexTest(schema, modules);
		const { guideRoleId } = await seedRoles(t);
		const guideProfileId = await seedProfile(t, 'legacy-review-guide');
		await seedGuideClub(t, guideProfileId, guideRoleId);
		const applicantProfileId = await seedProfile(t, 'applicant-legacy');
		const seasonId = await seedSeason(t);
		const applicationId = await seedApplication(t, applicantProfileId, {
			reviewSeasonId: seasonId
		});

		await t.run((ctx) => {
			const now = Date.now();
			return ctx.db.insert('applicationReviews', {
				applicationId,
				reviewerProfileId: guideProfileId,
				principlesScore: 6,
				safetyScore: 6,
				score: 6,
				note: 'Existing review, no assignment row',
				createdAt: now,
				updatedAt: now
			});
		});

		const result = await t
			.withIdentity({ subject: 'legacy-review-guide' })
			.mutation(api.clubApplications.upsertApplicationReview, {
				applicationId,
				alignmentScore: 5,
				motivationScore: 4,
				readinessScore: 3,
				note: 'Updated note'
			});

		// Re-scored on the 1-5 scale (CL-780): the legacy 0-10 pair is dropped.
		const review = await t.run((ctx) => ctx.db.get(result.reviewId));
		expect(review?.score).toBe(4);
		expect(review?.principlesScore).toBeUndefined();
		expect(review?.safetyScore).toBeUndefined();
	});
});

describe('score discrepancy escalation', () => {
	it('averages the three 1-5 scores and posts a discrepancy alert once the spread is >= 2', async () => {
		const t = convexTest(schema, modules);
		const { guideRoleId } = await seedRoles(t);
		const guideAProfileId = await seedProfile(t, 'discrepancy-guide-a');
		const guideBProfileId = await seedProfile(t, 'discrepancy-guide-b');
		await seedGuideClub(t, guideAProfileId, guideRoleId);
		await seedGuideClub(t, guideBProfileId, guideRoleId);

		const applicantProfileId = await seedProfile(t, 'applicant-discrepancy');
		const seasonId = await seedSeason(t);
		const applicationId = await seedApplication(t, applicantProfileId, {
			reviewSeasonId: seasonId
		});
		await t.run(async (ctx) => {
			const now = Date.now();
			await ctx.db.insert('applicationReviewAssignments', {
				applicationId,
				reviewerProfileId: guideAProfileId,
				seasonId,
				assignedAt: now
			});
			await ctx.db.insert('applicationReviewAssignments', {
				applicationId,
				reviewerProfileId: guideBProfileId,
				seasonId,
				assignedAt: now
			});
		});

		// First review: 5/5/5 -> average 5. No discrepancy yet (only 1 review).
		await t
			.withIdentity({ subject: 'discrepancy-guide-a' })
			.mutation(api.clubApplications.upsertApplicationReview, {
				applicationId,
				alignmentScore: 5,
				motivationScore: 5,
				readinessScore: 5,
				note: 'Excellent'
			});
		let scheduledJobs = await t.run((ctx) => ctx.db.system.query('_scheduled_functions').collect());
		expect(scheduledJobs.some((j) => j.name.includes('notifyApplicationScoreDiscrepancy'))).toBe(
			false
		);

		// Second review: 2/3/4 -> average 3. Spread |5-3| = 2 >= 2: should alert.
		await t
			.withIdentity({ subject: 'discrepancy-guide-b' })
			.mutation(api.clubApplications.upsertApplicationReview, {
				applicationId,
				alignmentScore: 2,
				motivationScore: 3,
				readinessScore: 4,
				note: 'Concerned'
			});

		scheduledJobs = await t.run((ctx) => ctx.db.system.query('_scheduled_functions').collect());
		expect(scheduledJobs.some((j) => j.name.includes('notifyApplicationScoreDiscrepancy'))).toBe(
			true
		);

		const reviews = await t.run((ctx) =>
			ctx.db
				.query('applicationReviews')
				.withIndex('by_application_id', (q) => q.eq('applicationId', applicationId))
				.collect()
		);
		expect(reviews.map((r) => r.score).sort()).toEqual([3, 5]);

		// Draining the scheduled action must not throw even with no webhook URL configured.
		await t.finishAllScheduledFunctions(() => Promise.resolve());
	});
});

describe('adminUpdateReviewSettings', () => {
	it('is admin-gated and persists custom settings used by the assignment algorithm', async () => {
		const t = convexTest(schema, modules);
		const { guideRoleId } = await seedRoles(t);
		const adminProfileId = await seedProfile(t, 'admin-user');
		await t.run((ctx) => ctx.db.patch(adminProfileId, { globalRole: 'admin' }));
		await seedProfile(t, 'non-admin-user');

		await expect(
			t
				.withIdentity({ subject: 'non-admin-user' })
				.mutation(api.reviewAssignmentModel.adminUpdateReviewSettings, {
					reviewersPerApplication: 1,
					maxReviewsPerGuidePerSeason: 1
				})
		).rejects.toThrow('Not authorized');

		await t
			.withIdentity({ subject: 'admin-user' })
			.mutation(api.reviewAssignmentModel.adminUpdateReviewSettings, {
				reviewersPerApplication: 2,
				maxReviewsPerGuidePerSeason: 5
			});

		const settings = await t
			.withIdentity({ subject: 'admin-user' })
			.query(api.reviewAssignmentModel.adminGetReviewSettings, {});
		expect(settings).toMatchObject({ reviewersPerApplication: 2, maxReviewsPerGuidePerSeason: 5 });
		expect(settings.updatedAt).toEqual(expect.any(Number));

		// Sanity check the algorithm actually reads it back: 3 eligible guides but capped at 2 per
		// application by the updated reviewersPerApplication.
		const guideCProfileId = await seedProfile(t, 'settings-guide-c');
		await seedGuideClub(t, guideCProfileId, guideRoleId);
		const guideProfileId = await seedProfile(t, 'settings-guide-a');
		await seedGuideClub(t, guideProfileId, guideRoleId);
		const applicantProfileId = await seedProfile(t, 'applicant-settings');
		const seasonId = await seedSeason(t);
		await seedApplication(t, applicantProfileId, { reviewSeasonId: seasonId });

		const result = await t.mutation(internal.reviewAssignmentModel.assignReviewsForOpenWindow, {});
		expect(result.assignmentsCreated).toBe(2);
	});
});

// CL-795: 5 reviewers by default, an admin settings screen, and applications already being
// reviewed keep the target they were first assigned with.
describe('review settings (CL-795)', () => {
	const seedGuides = async (
		t: ReturnType<typeof convexTest>,
		guideRoleId: Id<'clubRoles'>,
		n: number
	) => {
		const ids: Id<'profiles'>[] = [];
		for (let i = 0; i < n; i++) {
			const profileId = await seedProfile(t, `cl795-guide-${i}`);
			await seedGuideClub(t, profileId, guideRoleId);
			ids.push(profileId);
		}
		return ids;
	};

	it('assigns 5 reviewers by default and records that target on each row', async () => {
		const t = convexTest(schema, modules);
		const { guideRoleId } = await seedRoles(t);
		await seedGuides(t, guideRoleId, 7);
		const seasonId = await seedSeason(t);
		const applicationId = await seedApplication(t, await seedProfile(t, 'cl795-applicant'), {
			reviewSeasonId: seasonId
		});

		const result = await t.mutation(internal.reviewAssignmentModel.assignReviewsForOpenWindow, {});
		expect(result.assignmentsCreated).toBe(5);
		const rows = await t.run((ctx) =>
			ctx.db
				.query('applicationReviewAssignments')
				.withIndex('by_application_id', (q) => q.eq('applicationId', applicationId))
				.collect()
		);
		expect(rows.map((row) => row.targetReviewers)).toEqual([5, 5, 5, 5, 5]);
	});

	it('does not top up applications assigned before CL-795 beyond the old 3', async () => {
		const t = convexTest(schema, modules);
		const { guideRoleId } = await seedRoles(t);
		const guides = await seedGuides(t, guideRoleId, 8);
		const seasonId = await seedSeason(t);
		const fullyAssigned = await seedApplication(t, await seedProfile(t, 'cl795-old-full'), {
			reviewSeasonId: seasonId
		});
		const partlyAssigned = await seedApplication(t, await seedProfile(t, 'cl795-old-part'), {
			reviewSeasonId: seasonId
		});
		// Rows the old code wrote: no targetReviewers.
		await t.run(async (ctx) => {
			for (const reviewerProfileId of guides.slice(0, 3)) {
				await ctx.db.insert('applicationReviewAssignments', {
					applicationId: fullyAssigned,
					reviewerProfileId,
					seasonId,
					assignedAt: Date.now()
				});
			}
			await ctx.db.insert('applicationReviewAssignments', {
				applicationId: partlyAssigned,
				reviewerProfileId: guides[3],
				seasonId,
				assignedAt: Date.now()
			});
		});

		await t.mutation(internal.reviewAssignmentModel.assignReviewsForOpenWindow, {});
		const countFor = (applicationId: Id<'clubApplications'>) =>
			t.run(
				async (ctx) =>
					(
						await ctx.db
							.query('applicationReviewAssignments')
							.withIndex('by_application_id', (q) => q.eq('applicationId', applicationId))
							.collect()
					).length
			);
		expect(await countFor(fullyAssigned)).toBe(3);
		// Still topped up (e.g. too few Guides on day one), but only to the old target.
		expect(await countFor(partlyAssigned)).toBe(3);
	});

	it('keeps an application on its first target when the setting changes; new ones use the new setting', async () => {
		const t = convexTest(schema, modules);
		const { guideRoleId } = await seedRoles(t);
		await seedGuides(t, guideRoleId, 12);
		const asAdmin = await seedAdmin(t);
		await asAdmin.mutation(api.reviewAssignmentModel.adminUpdateReviewSettings, {
			reviewersPerApplication: 2,
			maxReviewsPerGuidePerSeason: 10
		});
		const seasonId = await seedSeason(t);
		const first = await seedApplication(t, await seedProfile(t, 'cl795-first'), {
			reviewSeasonId: seasonId
		});
		await t.mutation(internal.reviewAssignmentModel.assignReviewsForOpenWindow, {});

		await asAdmin.mutation(api.reviewAssignmentModel.adminUpdateReviewSettings, {
			reviewersPerApplication: 4,
			maxReviewsPerGuidePerSeason: 10
		});
		const second = await seedApplication(t, await seedProfile(t, 'cl795-second'), {
			reviewSeasonId: seasonId
		});
		await t.mutation(internal.reviewAssignmentModel.assignReviewsForOpenWindow, {});

		const countFor = (applicationId: Id<'clubApplications'>) =>
			t.run(
				async (ctx) =>
					(
						await ctx.db
							.query('applicationReviewAssignments')
							.withIndex('by_application_id', (q) => q.eq('applicationId', applicationId))
							.collect()
					).length
			);
		expect(await countFor(first)).toBe(2);
		expect(await countFor(second)).toBe(4);
	});

	it('a reviewer an admin attaches first does not cap the application at the old 3', async () => {
		const t = convexTest(schema, modules);
		const { guideRoleId } = await seedRoles(t);
		const guides = await seedGuides(t, guideRoleId, 7);
		const asAdmin = await seedAdmin(t);
		const seasonId = await seedSeason(t);
		const applicationId = await seedApplication(t, await seedProfile(t, 'cl795-manual'), {
			reviewSeasonId: seasonId
		});
		await asAdmin.mutation(api.admin.adminAssignReviewer, {
			applicationId,
			profileId: guides[0]
		});

		await t.mutation(internal.reviewAssignmentModel.assignReviewsForOpenWindow, {});
		const rows = await t.run((ctx) =>
			ctx.db
				.query('applicationReviewAssignments')
				.withIndex('by_application_id', (q) => q.eq('applicationId', applicationId))
				.collect()
		);
		expect(rows).toHaveLength(5);
	});

	it('returns defaults, limits and the Guide pool, and rejects out-of-range values', async () => {
		const t = convexTest(schema, modules);
		const { guideRoleId } = await seedRoles(t);
		await seedGuides(t, guideRoleId, 2);
		const asAdmin = await seedAdmin(t);

		const initial = await asAdmin.query(api.reviewAssignmentModel.adminGetReviewSettings, {});
		expect(initial).toEqual({
			reviewersPerApplication: 5,
			maxReviewsPerGuidePerSeason: 10,
			updatedAt: null,
			defaults: { reviewersPerApplication: 5, maxReviewsPerGuidePerSeason: 10 },
			limits: {
				reviewersPerApplication: { min: 1, max: 20 },
				maxReviewsPerGuidePerSeason: { min: 1, max: 100 }
			},
			eligibleGuideCount: 2
		});

		for (const bad of [
			{ reviewersPerApplication: 0, maxReviewsPerGuidePerSeason: 10 },
			{ reviewersPerApplication: 21, maxReviewsPerGuidePerSeason: 10 },
			{ reviewersPerApplication: 2.5, maxReviewsPerGuidePerSeason: 10 },
			{ reviewersPerApplication: 5, maxReviewsPerGuidePerSeason: 0 },
			{ reviewersPerApplication: 5, maxReviewsPerGuidePerSeason: 101 }
		]) {
			await expect(
				asAdmin.mutation(api.reviewAssignmentModel.adminUpdateReviewSettings, bad)
			).rejects.toThrow('must be a whole number');
		}
		const unchanged = await asAdmin.query(api.reviewAssignmentModel.adminGetReviewSettings, {});
		expect(unchanged.updatedAt).toBeNull();

		await expect(
			t
				.withIdentity({ subject: 'nobody' })
				.query(api.reviewAssignmentModel.adminGetReviewSettings, {})
		).rejects.toThrow();
	});
});
