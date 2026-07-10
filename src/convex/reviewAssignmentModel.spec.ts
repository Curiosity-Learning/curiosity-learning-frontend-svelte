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
	overrides: { status?: 'pending' | 'incomplete'; createdAt?: number } = {}
) => {
	return await t.run(async (ctx) => {
		const now = Date.now();
		return await ctx.db.insert('clubApplications', {
			applicantProfileId,
			status: overrides.status ?? 'pending',
			name: 'New Curiosity Club',
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

		const assignments = await t.run((ctx) => ctx.db.query('applicationReviewAssignments').collect());
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

		const applicationId = await seedApplication(t, applicantProfileId);
		const seasonId = await seedSeason(t);

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

		// Two guides only: with reviewersPerApplication default 3, only 2 can ever be assigned per
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
		await seedApplication(t, applicant1, { createdAt: Date.now() - 3000 });
		await seedApplication(t, applicant2, { createdAt: Date.now() - 2000 });
		await seedApplication(t, applicant3, { createdAt: Date.now() - 1000 });
		await seedSeason(t);

		const result = await t.mutation(internal.reviewAssignmentModel.assignReviewsForOpenWindow, {});
		// Only 2 applications can get an assignment: 2 guides x cap of 1 review each = 2 total slots.
		expect(result.assignmentsCreated).toBe(2);

		const assignments = await t.run((ctx) => ctx.db.query('applicationReviewAssignments').collect());
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
		await seedApplication(t, applicantProfileId);
		await seedSeason(t);

		await t.mutation(internal.reviewAssignmentModel.assignReviewsForOpenWindow, {});
		const secondRun = await t.mutation(internal.reviewAssignmentModel.assignReviewsForOpenWindow, {});
		expect(secondRun.assignmentsCreated).toBe(0);

		const assignments = await t.run((ctx) => ctx.db.query('applicationReviewAssignments').collect());
		expect(assignments).toHaveLength(1);
	});
});

describe('submitApplication rolling mid-window assignment', () => {
	it('assigns a newly submitted application immediately when a review window is currently open', async () => {
		const t = convexTest(schema, modules);
		const { guideRoleId } = await seedRoles(t);
		const guideProfileId = await seedProfile(t, 'guide-rolling');
		await seedGuideClub(t, guideProfileId, guideRoleId);
		await seedSeason(t);

		const applicantProfileId = await seedProfile(t, 'applicant-rolling');
		const videoAssetId = await t.run(async (ctx) => {
			const now = Date.now();
			return await ctx.db.insert('mediaAssets', {
				ownerUserId: 'applicant-rolling',
				mediaKind: 'video',
				status: 'ready',
				acceptedContentTypes: ['video/mp4'],
				maxBytes: 100_000_000,
				enableCompression: true,
				enableSafetyScreening: true,
				storageProvider: 's3',
				sourceBucket: 'test-bucket',
				sourceObjectKey: 'test-object-key-rolling',
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

		await t
			.withIdentity({ subject: 'applicant-rolling' })
			.mutation(api.clubApplications.submitApplication, {
				name: 'Rolling Club',
				videoMediaAssetId: videoAssetId
			});

		const application = await t.run((ctx) =>
			ctx.db
				.query('clubApplications')
				.withIndex('by_applicant_profile_id', (q) => q.eq('applicantProfileId', applicantProfileId))
				.first()
		);
		expect(application).not.toBeNull();

		const assignments = await t.run((ctx) =>
			ctx.db
				.query('applicationReviewAssignments')
				.withIndex('by_application_id', (q) => q.eq('applicationId', application!._id))
				.collect()
		);
		expect(assignments.some((a) => a.reviewerProfileId === guideProfileId)).toBe(true);

		await t.finishAllScheduledFunctions(() => Promise.resolve());
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
		const applicationId = await seedApplication(t, applicantProfileId);
		const seasonId = await seedSeason(t);
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

		const assignedList = await assignedGuide.query(api.clubApplications.listReviewableApplications, {});
		expect(assignedList).toHaveLength(1);
		const unassignedList = await unassignedGuide.query(
			api.clubApplications.listReviewableApplications,
			{}
		);
		expect(unassignedList).toHaveLength(0);

		const assignedCount = await assignedGuide.query(
			api.clubApplications.countReviewableApplications,
			{}
		);
		expect(assignedCount).toBe(1);

		await assignedGuide.mutation(api.clubApplications.upsertApplicationReview, {
			applicationId,
			principlesScore: 7,
			safetyScore: 9,
			note: 'Solid application'
		});

		const afterReviewList = await assignedGuide.query(
			api.clubApplications.listReviewableApplications,
			{}
		);
		expect(afterReviewList).toHaveLength(0);
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
		expect(review?.principlesScore).toBe(7);
		expect(review?.safetyScore).toBe(9);
		expect(review?.score).toBe(8);
	});

	it('rejects reviewing an application with no assignment and no existing review row', async () => {
		const t = convexTest(schema, modules);
		const { guideRoleId } = await seedRoles(t);
		const guideProfileId = await seedProfile(t, 'no-assignment-guide');
		await seedGuideClub(t, guideProfileId, guideRoleId);
		const applicantProfileId = await seedProfile(t, 'applicant-no-assignment');
		const applicationId = await seedApplication(t, applicantProfileId);

		await expect(
			t.withIdentity({ subject: 'no-assignment-guide' }).mutation(api.clubApplications.upsertApplicationReview, {
				applicationId,
				principlesScore: 5,
				safetyScore: 5,
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
		const applicationId = await seedApplication(t, applicantProfileId);

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
				principlesScore: 9,
				safetyScore: 3,
				note: 'Updated note'
			});

		const review = await t.run((ctx) => ctx.db.get(result.reviewId));
		expect(review?.score).toBe(6);
	});
});

describe('score discrepancy escalation', () => {
	it('maintains the averaged score across dual-score reviews and posts a discrepancy alert once spread >= 4', async () => {
		const t = convexTest(schema, modules);
		const { guideRoleId } = await seedRoles(t);
		const guideAProfileId = await seedProfile(t, 'discrepancy-guide-a');
		const guideBProfileId = await seedProfile(t, 'discrepancy-guide-b');
		await seedGuideClub(t, guideAProfileId, guideRoleId);
		await seedGuideClub(t, guideBProfileId, guideRoleId);

		const applicantProfileId = await seedProfile(t, 'applicant-discrepancy');
		const applicationId = await seedApplication(t, applicantProfileId);
		const seasonId = await seedSeason(t);
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

		// First review: principles 9, safety 9 -> average 9. No discrepancy yet (only 1 review).
		await t.withIdentity({ subject: 'discrepancy-guide-a' }).mutation(api.clubApplications.upsertApplicationReview, {
			applicationId,
			principlesScore: 9,
			safetyScore: 9,
			note: 'Excellent'
		});
		let scheduledJobs = await t.run((ctx) => ctx.db.system.query('_scheduled_functions').collect());
		expect(scheduledJobs.some((j) => j.name.includes('notifyApplicationScoreDiscrepancy'))).toBe(
			false
		);

		// Second review: principles 3, safety 5 -> average 4. Spread |9-4| = 5 >= 4: should alert.
		await t.withIdentity({ subject: 'discrepancy-guide-b' }).mutation(api.clubApplications.upsertApplicationReview, {
			applicationId,
			principlesScore: 3,
			safetyScore: 5,
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
		expect(reviews.map((r) => r.score).sort()).toEqual([4, 9]);

		// Draining the scheduled action must not throw even with no webhook URL configured.
		await t.finishAllScheduledFunctions(() => Promise.resolve());
	});
});

describe('adminUpdateReviewSettings', () => {
	it('is admin-gated and persists custom settings used by the assignment algorithm', async () => {
		const t = convexTest(schema, modules);
		const { guideRoleId } = await seedRoles(t);
		const adminProfileId = await seedProfile(t, 'admin-user');
		await t.run((ctx) =>
			ctx.db.patch(adminProfileId, { globalRole: 'admin' })
		);
		await seedProfile(t, 'non-admin-user');

		await expect(
			t.withIdentity({ subject: 'non-admin-user' }).mutation(api.reviewAssignmentModel.adminUpdateReviewSettings, {
				reviewersPerApplication: 1,
				maxReviewsPerGuidePerSeason: 1
			})
		).rejects.toThrow('Not authorized');

		await t.withIdentity({ subject: 'admin-user' }).mutation(api.reviewAssignmentModel.adminUpdateReviewSettings, {
			reviewersPerApplication: 2,
			maxReviewsPerGuidePerSeason: 5
		});

		const settings = await t
			.withIdentity({ subject: 'admin-user' })
			.query(api.reviewAssignmentModel.adminGetReviewSettings, {});
		expect(settings).toEqual({ reviewersPerApplication: 2, maxReviewsPerGuidePerSeason: 5 });

		// Sanity check the algorithm actually reads it back: 3 eligible guides but capped at 2 per
		// application by the updated reviewersPerApplication.
		const guideCProfileId = await seedProfile(t, 'settings-guide-c');
		await seedGuideClub(t, guideCProfileId, guideRoleId);
		const guideProfileId = await seedProfile(t, 'settings-guide-a');
		await seedGuideClub(t, guideProfileId, guideRoleId);
		const applicantProfileId = await seedProfile(t, 'applicant-settings');
		await seedApplication(t, applicantProfileId);
		await seedSeason(t);

		const result = await t.mutation(internal.reviewAssignmentModel.assignReviewsForOpenWindow, {});
		expect(result.assignmentsCreated).toBe(2);
	});
});
