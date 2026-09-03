/// <reference types="vite/client" />

import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

const seedApplicationFixture = async () => {
	const t = convexTest(schema, modules);
	const ids = await t.run(async (ctx) => {
		const now = Date.now();
		const guideRoleId = await ctx.db.insert('clubRoles', {
			key: 'guide',
			name: 'Guide',
			permissions: ['club:read'],
			order: 0,
			createdAt: now
		});
		await ctx.db.insert('clubRoles', {
			key: 'learner',
			name: 'Learner',
			permissions: ['club:read'],
			order: 1,
			createdAt: now
		});

		const reviewerProfileId = await ctx.db.insert('profiles', {
			authUserId: 'reviewer-user',
			username: 'reviewer',
			firstName: 'Rev',
			lastName: 'Iewer',
			isVerified: true,
			firstLoginCompleted: true,
			updatedAt: now
		});

		const reviewerClubId = await ctx.db.insert('clubs', {
			name: 'Existing Club',
			clubCode: 'EXIST1',
			discoverable: false,
			createdByProfileId: reviewerProfileId,
			createdAt: now,
			updatedAt: now
		});
		await ctx.db.insert('clubMembers', {
			clubId: reviewerClubId,
			profileId: reviewerProfileId,
			roleId: guideRoleId,
			createdAt: now
		});

		const otherReviewerProfileId = await ctx.db.insert('profiles', {
			authUserId: 'other-reviewer-user',
			username: 'other-reviewer',
			isVerified: true,
			firstLoginCompleted: true,
			updatedAt: now
		});
		await ctx.db.insert('clubMembers', {
			clubId: reviewerClubId,
			profileId: otherReviewerProfileId,
			roleId: guideRoleId,
			createdAt: now
		});

		const applicantProfileId = await ctx.db.insert('profiles', {
			authUserId: 'applicant-user',
			username: 'applicant',
			firstName: 'App',
			lastName: 'Licant',
			isVerified: true,
			firstLoginCompleted: true,
			updatedAt: now
		});

		const applicationId = await ctx.db.insert('clubApplications', {
			applicantProfileId,
			status: 'pending',
			name: 'New Curiosity Club',
			description: 'A great club',
			createdAt: now,
			updatedAt: now
		});

		return { reviewerProfileId, otherReviewerProfileId, applicantProfileId, applicationId };
	});

	return {
		t,
		reviewer: t.withIdentity({ subject: 'reviewer-user' }),
		otherReviewer: t.withIdentity({ subject: 'other-reviewer-user' }),
		applicant: t.withIdentity({ subject: 'applicant-user' }),
		...ids
	};
};

const addReview = async (
	t: Awaited<ReturnType<typeof seedApplicationFixture>>['t'],
	applicationId: Id<'clubApplications'>,
	reviewerProfileId: Id<'profiles'>
) => {
	const now = Date.now();
	await t.run((ctx) =>
		ctx.db.insert('applicationReviews', {
			applicationId,
			reviewerProfileId,
			score: 8,
			note: 'Looks great',
			createdAt: now,
			updatedAt: now
		})
	);
};

// Staff move applications to interview from the admin portal (admin.adminMoveToInterview); for
// these Guide-side decision tests we stage the row directly.
const moveToInterviewAsStaff = async (
	t: Awaited<ReturnType<typeof seedApplicationFixture>>['t'],
	applicationId: Id<'clubApplications'>
) => {
	const now = Date.now();
	await t.run(async (ctx) => {
		await ctx.db.patch(applicationId, {
			status: 'interview',
			movedToInterviewAt: now,
			updatedAt: now
		});
		const { ensureClubApplicationRoom } = await import('./chatModel');
		await ensureClubApplicationRoom(ctx, applicationId);
	});
};

describe('application decision pipeline', () => {
	const setupReviewedApplication = async () => {
		const fixture = await seedApplicationFixture();
		await fixture.t.run((ctx) =>
			ctx.db.insert('applicationReviews', {
				applicationId: fixture.applicationId,
				reviewerProfileId: fixture.reviewerProfileId,
				score: 8,
				note: 'Looks great',
				createdAt: Date.now(),
				updatedAt: Date.now()
			})
		);
		return fixture;
	};

	it('rejects deciding an application that is not in interview', async () => {
		const { reviewer, applicationId } = await setupReviewedApplication();
		await expect(
			reviewer.mutation(api.clubApplications.decideApplication, {
				applicationId,
				decision: 'accepted'
			})
		).rejects.toThrow('This application is not awaiting a decision');
	});

	it('enforces the deciding-reviewer gate on decideApplication', async () => {
		const { otherReviewer, applicationId, t } = await setupReviewedApplication();
		await moveToInterviewAsStaff(t, applicationId);
		await expect(
			otherReviewer.mutation(api.clubApplications.decideApplication, {
				applicationId,
				decision: 'accepted'
			})
		).rejects.toThrow('Only a Guide who reviewed this application can do this');
	});

	// CL-710 CEO review item 3: the interview IS the onboarding call, so accepting now creates the
	// club inline — there is no more separate confirm-onboarding-call step.
	it('accepts an application, creates the club immediately, and notifies the applicant', async () => {
		const { reviewer, applicantProfileId, applicationId, t } = await setupReviewedApplication();
		await moveToInterviewAsStaff(t, applicationId);

		await reviewer.mutation(api.clubApplications.decideApplication, {
			applicationId,
			decision: 'accepted'
		});

		const application = await t.run((ctx) => ctx.db.get(applicationId));
		expect(application?.status).toBe('accepted');
		expect(application?.decidedByProfileId).toBeDefined();
		expect(application?.createdClubId).toBeDefined();

		const applicantProfile = await t.run((ctx) => ctx.db.get(applicantProfileId));
		expect(applicantProfile?.activeClubId).toBe(application?.createdClubId);

		const membership = await t.run((ctx) =>
			ctx.db
				.query('clubMembers')
				.withIndex('by_club_and_profile', (q) =>
					q.eq('clubId', application!.createdClubId!).eq('profileId', applicantProfileId)
				)
				.first()
		);
		expect(membership).not.toBeNull();

		const createdClub = await t.run((ctx) => ctx.db.get(application!.createdClubId!));
		expect(createdClub?.discoverable).toBe(true);

		const notifications = await t.run((ctx) =>
			ctx.db
				.query('notifications')
				.withIndex('by_profile', (q) => q.eq('profileId', applicantProfileId))
				.collect()
		);
		expect(notifications.some((n) => n.title === 'Application accepted')).toBe(true);
	});

	it('is idempotent if decideApplication were somehow invoked twice for the same acceptance', async () => {
		const { reviewer, applicationId, t } = await setupReviewedApplication();
		await moveToInterviewAsStaff(t, applicationId);
		await reviewer.mutation(api.clubApplications.decideApplication, {
			applicationId,
			decision: 'accepted'
		});
		const clubCountAfterFirstAccept = (await t.run((ctx) => ctx.db.query('clubs').collect()))
			.length;

		// Once accepted, status is no longer 'interview', so a second decision attempt is rejected
		// cleanly rather than creating another club (or another Club of Clubs group).
		await expect(
			reviewer.mutation(api.clubApplications.decideApplication, {
				applicationId,
				decision: 'accepted'
			})
		).rejects.toThrow('This application is not awaiting a decision');

		const clubs = await t.run((ctx) => ctx.db.query('clubs').collect());
		expect(clubs).toHaveLength(clubCountAfterFirstAccept);
	});

	it('rejects an application, posts the personal note and a system message, and notifies the applicant', async () => {
		const { reviewer, applicantProfileId, applicationId, t } = await setupReviewedApplication();
		await moveToInterviewAsStaff(t, applicationId);

		await reviewer.mutation(api.clubApplications.decideApplication, {
			applicationId,
			decision: 'rejected',
			rejectionNote: 'Not the right fit for now.'
		});

		const application = await t.run((ctx) => ctx.db.get(applicationId));
		expect(application?.status).toBe('rejected');
		expect(application?.rejectionNote).toBe('Not the right fit for now.');

		const room = await t.run((ctx) =>
			ctx.db
				.query('rooms')
				.withIndex('by_club_application_id', (q) => q.eq('clubApplicationId', applicationId))
				.first()
		);
		const messages = await t.run((ctx) =>
			ctx.db
				.query('messages')
				.withIndex('by_room', (q) => q.eq('roomId', room!._id))
				.collect()
		);
		expect(messages.some((m) => m.content === 'Not the right fit for now.')).toBe(true);
		expect(messages.some((m) => m.profileId === undefined)).toBe(true);

		const notifications = await t.run((ctx) =>
			ctx.db
				.query('notifications')
				.withIndex('by_profile', (q) => q.eq('profileId', applicantProfileId))
				.collect()
		);
		expect(notifications.some((n) => n.title === 'Application update')).toBe(true);
	});

	// CL-710 CEO review item 4: the chat stays open (sendable) after a decision — accepted or
	// rejected — so the applicant can still reach out for support later.
	it('keeps the chat open and sendable for the applicant once rejected', async () => {
		const { reviewer, applicant, applicationId, t } = await setupReviewedApplication();
		await moveToInterviewAsStaff(t, applicationId);
		await reviewer.mutation(api.clubApplications.decideApplication, {
			applicationId,
			decision: 'rejected'
		});

		const room = await t.run((ctx) =>
			ctx.db
				.query('rooms')
				.withIndex('by_club_application_id', (q) => q.eq('clubApplicationId', applicationId))
				.first()
		);

		const summaries = await applicant.query(api.chat.listRoomSummaries, {});
		expect(summaries).toContainEqual(expect.objectContaining({ roomId: room!._id, canSend: true }));

		const sent = await applicant.mutation(api.chat.sendMessage, {
			roomId: room!._id,
			content: 'Still there?'
		});
		expect(sent).toMatchObject({ content: 'Still there?' });
	});

	// CL-710 CEO review item 4: same guarantee once accepted (club already created) — a new Guide
	// should still be able to message their interviewer for support.
	it('keeps the chat open and sendable for the applicant once accepted', async () => {
		const { reviewer, applicant, applicationId, t } = await setupReviewedApplication();
		await moveToInterviewAsStaff(t, applicationId);
		await reviewer.mutation(api.clubApplications.decideApplication, {
			applicationId,
			decision: 'accepted'
		});

		const room = await t.run((ctx) =>
			ctx.db
				.query('rooms')
				.withIndex('by_club_application_id', (q) => q.eq('clubApplicationId', applicationId))
				.first()
		);

		const summaries = await applicant.query(api.chat.listRoomSummaries, {});
		expect(summaries).toContainEqual(expect.objectContaining({ roomId: room!._id, canSend: true }));

		const sent = await applicant.mutation(api.chat.sendMessage, {
			roomId: room!._id,
			content: 'Thanks for the interview!'
		});
		expect(sent).toMatchObject({ content: 'Thanks for the interview!' });
	});

	it('sets and requires the follow-up flag only while accepted', async () => {
		const { reviewer, applicationId, t } = await setupReviewedApplication();
		await expect(
			reviewer.mutation(api.clubApplications.setAdminFollowUpFlag, {
				applicationId,
				reason: 'No-show'
			})
		).rejects.toThrow('Only accepted applications can be flagged for follow-up');

		await moveToInterviewAsStaff(t, applicationId);
		await reviewer.mutation(api.clubApplications.decideApplication, {
			applicationId,
			decision: 'accepted'
		});

		await reviewer.mutation(api.clubApplications.setAdminFollowUpFlag, {
			applicationId,
			reason: 'No-show / failed to schedule'
		});
	});
});

describe('getApplicationForRoom', () => {
	it('returns decide flags for the applicant and reviewer, and rejects outsiders', async () => {
		const { reviewer, otherReviewer, applicant, reviewerProfileId, applicationId, t } =
			await seedApplicationFixture();
		await addReview(t, applicationId, reviewerProfileId);

		// Ensure the chat room exists (normally created by submitApplication/upsertApplicationReview).
		const roomId = await t.run(async (ctx) => {
			const { ensureClubApplicationRoom } = await import('./chatModel');
			return await ensureClubApplicationRoom(ctx, applicationId);
		});

		const asApplicant = await applicant.query(api.clubApplications.getApplicationForRoom, {
			roomId
		});
		expect(asApplicant).toMatchObject({
			isApplicant: true,
			canDecide: false,
			status: 'pending',
			// CL-710 CEO review item 2: no video uploaded in this fixture, so it resolves to null
			// rather than throwing.
			videoUrl: null
		});

		const asReviewer = await reviewer.query(api.clubApplications.getApplicationForRoom, {
			roomId
		});
		expect(asReviewer).toMatchObject({ isApplicant: false, canDecide: true, status: 'pending' });

		await expect(
			otherReviewer.query(api.clubApplications.getApplicationForRoom, { roomId })
		).rejects.toThrow('You cannot access this chat');
	});
});

// CL-710 CEO review round 3 (Braga bug): the CEO's fresh "Braga" start-club application had a
// video that didn't show in the review chat. The asset itself was healthy — status 'ready',
// mediaKind 'video', moderation.status 'skipped-video' (video safety screening is intentionally
// out of scope for v1, see mediaPipeline.ts's safety-screening plugin) — so the bug was never
// about asset readiness or moderation gating (resolveApplicationVideoUrl/resolveClubVideoUrl never
// checked moderation status at all). The real cause: resolveApplicationVideoUrl only ever produces
// a *direct* storage URL, which 403s once secure media delivery (CloudFront signing) is
// configured, because the backing bucket is then private (confirmed against curiosity-club-main-s3
// in the dev deployment). This suite seeds a video asset in exactly that state and exercises the
// new getApplicationVideoDeliveryAsset query, which the client now signs via
// /api/media/refresh (src/lib/server/signed-media.ts's getSignedApplicationVideoAsset) instead of
// relying solely on the direct URL.
describe('getApplicationVideoDeliveryAsset', () => {
	const insertBragaLikeVideoAsset = async (
		t: Awaited<ReturnType<typeof seedApplicationFixture>>['t'],
		ownerUserId: string
	) => {
		const now = Date.now();
		return await t.run(async (ctx) =>
			ctx.db.insert('mediaAssets', {
				ownerUserId,
				mediaKind: 'video',
				status: 'ready',
				acceptedContentTypes: ['video/quicktime'],
				maxBytes: 100_000_000,
				enableCompression: true,
				enableSafetyScreening: true,
				storageProvider: 's3',
				sourceBucket: 'curiosity-club-main-s3',
				sourceObjectKey: 'production/media-assets/owners/owner/assets/asset/raw/r1/movie.mov',
				sourceObjectRevision: 1,
				contentType: 'video/quicktime',
				sizeBytes: 9_286_411,
				durationSeconds: 7.3,
				// Video NSFW screening is out of scope for v1 (see mediaPipeline.ts) — every real video
				// asset ends up in this state, never 'clean'/'flagged'/'blocked'.
				moderation: { status: 'skipped-video', labels: [] },
				pipelineVersion: 1,
				attemptCount: 1,
				stepResults: [],
				createdAt: now,
				updatedAt: now,
				readyAt: now
			})
		);
	};

	it('resolves a delivery asset for the applicant and for a reviewer who reviewed it', async () => {
		const { reviewer, applicant, reviewerProfileId, applicantProfileId, applicationId, t } =
			await seedApplicationFixture();
		const videoMediaAssetId = await insertBragaLikeVideoAsset(t, 'applicant-user');
		await t.run((ctx) => ctx.db.patch(applicationId, { videoMediaAssetId }));
		await addReview(t, applicationId, reviewerProfileId);

		const asApplicant = await applicant.query(
			api.clubApplications.getApplicationVideoDeliveryAsset,
			{
				applicationId
			}
		);
		expect(asApplicant).toMatchObject({
			assetId: videoMediaAssetId,
			storageProvider: 's3',
			deliveryBucket: 'curiosity-club-main-s3',
			deliveryObjectKey: 'production/media-assets/owners/owner/assets/asset/raw/r1/movie.mov',
			mediaKind: 'video'
		});

		const asReviewer = await reviewer.query(api.clubApplications.getApplicationVideoDeliveryAsset, {
			applicationId
		});
		expect(asReviewer).toMatchObject({ assetId: videoMediaAssetId, mediaKind: 'video' });

		// Sanity: applicantProfileId is part of the seeded fixture, unused here beyond documenting
		// that the applicant fixture identity above really is that profile's owner.
		expect(applicantProfileId).toBeDefined();
	});

	it('resolves a delivery asset for a Guide assigned to review it, before they have reviewed', async () => {
		const { otherReviewer, otherReviewerProfileId, applicationId, t } =
			await seedApplicationFixture();
		const videoMediaAssetId = await insertBragaLikeVideoAsset(t, 'applicant-user');
		await t.run((ctx) => ctx.db.patch(applicationId, { videoMediaAssetId }));
		const now = Date.now();
		const seasonId = await t.mutation(internal.seasons.createSeason, {
			name: 'Test Season',
			startDate: now + 60 * 24 * 60 * 60 * 1000,
			endDate: now + 120 * 24 * 60 * 60 * 1000,
			reviewWindowOpen: now - 24 * 60 * 60 * 1000,
			reviewWindowClose: now + 24 * 60 * 60 * 1000,
			feedbackDeadline: now + 150 * 24 * 60 * 60 * 1000
		});
		await t.run((ctx) =>
			ctx.db.insert('applicationReviewAssignments', {
				applicationId,
				reviewerProfileId: otherReviewerProfileId,
				seasonId,
				assignedAt: now
			})
		);

		const asAssignedReviewer = await otherReviewer.query(
			api.clubApplications.getApplicationVideoDeliveryAsset,
			{ applicationId }
		);
		expect(asAssignedReviewer).toMatchObject({ assetId: videoMediaAssetId });
	});

	it('resolves a delivery asset for a global admin (staff review from the admin portal)', async () => {
		const { applicationId, t } = await seedApplicationFixture();
		const videoMediaAssetId = await insertBragaLikeVideoAsset(t, 'applicant-user');
		await t.run((ctx) => ctx.db.patch(applicationId, { videoMediaAssetId }));
		const adminProfileId = await t.run((ctx) =>
			ctx.db.insert('profiles', {
				authUserId: 'admin-user',
				username: 'admin',
				isVerified: true,
				firstLoginCompleted: true,
				updatedAt: Date.now()
			})
		);
		await t.run((ctx) =>
			ctx.runMutation(internal.profiles.setGlobalRole, {
				profileId: adminProfileId,
				globalRole: 'admin'
			})
		);

		const asAdmin = await t
			.withIdentity({ subject: 'admin-user' })
			.query(api.clubApplications.getApplicationVideoDeliveryAsset, { applicationId });
		expect(asAdmin).toMatchObject({ assetId: videoMediaAssetId, mediaKind: 'video' });
	});

	it('denies a Guide with no assignment and no review', async () => {
		const { otherReviewer, reviewerProfileId, applicationId, t } = await seedApplicationFixture();
		const videoMediaAssetId = await insertBragaLikeVideoAsset(t, 'applicant-user');
		await t.run((ctx) => ctx.db.patch(applicationId, { videoMediaAssetId }));
		// Someone else reviewed it, but not `otherReviewer`.
		await addReview(t, applicationId, reviewerProfileId);

		await expect(
			otherReviewer.query(api.clubApplications.getApplicationVideoDeliveryAsset, { applicationId })
		).rejects.toThrow('Permission denied');
	});

	it('returns null (not an error) when no video was uploaded', async () => {
		const { applicant, applicationId } = await seedApplicationFixture();

		const result = await applicant.query(api.clubApplications.getApplicationVideoDeliveryAsset, {
			applicationId
		});
		expect(result).toBeNull();
	});
});

// Application detail page (/applications/review/{id}) + the chat page's per-room query share one
// audience (resolveApplicationViewer): applicant, admin, reviewer, assigned Guide.
describe('getApplication', () => {
	const DAY_MS = 24 * 60 * 60 * 1000;

	const assignReviewer = async (
		t: Awaited<ReturnType<typeof seedApplicationFixture>>['t'],
		applicationId: Id<'clubApplications'>,
		reviewerProfileId: Id<'profiles'>
	) => {
		const now = Date.now();
		const seasonId = await t.mutation(internal.seasons.createSeason, {
			name: 'Test Season',
			startDate: now + 60 * DAY_MS,
			endDate: now + 120 * DAY_MS,
			reviewWindowOpen: now - DAY_MS,
			reviewWindowClose: now + DAY_MS,
			feedbackDeadline: now + 150 * DAY_MS
		});
		await t.run((ctx) =>
			ctx.db.insert('applicationReviewAssignments', {
				applicationId,
				reviewerProfileId,
				seasonId,
				assignedAt: now
			})
		);
	};

	const seedAdmin = async (t: Awaited<ReturnType<typeof seedApplicationFixture>>['t']) => {
		const adminProfileId = await t.run((ctx) =>
			ctx.db.insert('profiles', {
				authUserId: 'admin-user',
				username: 'admin',
				isVerified: true,
				firstLoginCompleted: true,
				updatedAt: Date.now()
			})
		);
		await t.run((ctx) =>
			ctx.runMutation(internal.profiles.setGlobalRole, {
				profileId: adminProfileId,
				globalRole: 'admin'
			})
		);
		return t.withIdentity({ subject: 'admin-user' });
	};

	it('gives the applicant their own details but no review data', async () => {
		const { applicant, reviewerProfileId, applicationId, t } = await seedApplicationFixture();
		await addReview(t, applicationId, reviewerProfileId);

		const result = await applicant.query(api.clubApplications.getApplication, { applicationId });

		expect(result).toMatchObject({
			applicationId,
			name: 'New Curiosity Club',
			description: 'A great club',
			status: 'pending',
			applicant: { name: 'App Licant', username: 'applicant' },
			viewer: { role: 'applicant', hasReviewed: false, isAssigned: false },
			// No season with an open review window seeded → scoring is hidden.
			reviewWindowOpen: false,
			myReview: null,
			decision: null,
			review: null
		});
		// Nothing about who reviewed or what they wrote leaks through any field.
		const serialized = JSON.stringify(result);
		expect(serialized).not.toContain('Rev Iewer');
		expect(serialized).not.toContain('Looks great');
	});

	it('gives a reviewer only their own review, never other reviewers scores or names', async () => {
		const { reviewer, reviewerProfileId, otherReviewerProfileId, applicationId, t } =
			await seedApplicationFixture();
		await addReview(t, applicationId, reviewerProfileId);
		// Someone else reviewed it too; that must stay invisible to `reviewer`.
		await t.run((ctx) =>
			ctx.db.insert('applicationReviews', {
				applicationId,
				reviewerProfileId: otherReviewerProfileId,
				score: 3,
				note: 'Secret second opinion',
				createdAt: Date.now(),
				updatedAt: Date.now()
			})
		);

		const result = await reviewer.query(api.clubApplications.getApplication, { applicationId });

		expect(result?.viewer).toEqual({ role: 'reviewer', hasReviewed: true, isAssigned: false });
		expect(result?.myReview).toEqual({
			principlesScore: null,
			safetyScore: null,
			note: 'Looks great'
		});
		expect(result?.decision).toEqual({ decidedByName: null, adminFollowUpFlag: null });
		expect(result?.review).toBeNull();
		const serialized = JSON.stringify(result);
		expect(serialized).not.toContain('Secret second opinion');
		expect(serialized).not.toContain('other-reviewer');
	});

	it('gives an assigned Guide who has not reviewed yet no review data at all', async () => {
		const { otherReviewer, otherReviewerProfileId, reviewerProfileId, applicationId, t } =
			await seedApplicationFixture();
		await addReview(t, applicationId, reviewerProfileId);
		await assignReviewer(t, applicationId, otherReviewerProfileId);

		const result = await otherReviewer.query(api.clubApplications.getApplication, {
			applicationId
		});

		expect(result?.viewer).toEqual({ role: 'reviewer', hasReviewed: false, isAssigned: true });
		// assignReviewer seeds a season whose review window contains now.
		expect(result?.reviewWindowOpen).toBe(true);
		expect(result?.myReview).toBeNull();
		expect(result?.review).toBeNull();
		expect(JSON.stringify(result)).not.toContain('Looks great');
	});

	it('gives a global admin everything', async () => {
		const { reviewerProfileId, applicationId, t } = await seedApplicationFixture();
		await addReview(t, applicationId, reviewerProfileId);
		const admin = await seedAdmin(t);

		const result = await admin.query(api.clubApplications.getApplication, { applicationId });

		expect(result?.viewer).toEqual({ role: 'admin', hasReviewed: false, isAssigned: false });
		expect(result?.decision).toEqual({ decidedByName: null, adminFollowUpFlag: null });
		expect(result?.review?.reviews).toEqual([
			expect.objectContaining({ reviewerName: 'Rev Iewer', score: 8, note: 'Looks great' })
		]);
		expect(result?.review?.assignedReviewers).toEqual([]);
	});

	it('rejects a Guide with no assignment and no review', async () => {
		const { otherReviewer, reviewerProfileId, applicationId, t } = await seedApplicationFixture();
		await addReview(t, applicationId, reviewerProfileId);

		await expect(
			otherReviewer.query(api.clubApplications.getApplication, { applicationId })
		).rejects.toThrow('You cannot access this application');
	});

	it('returns null for an unknown application', async () => {
		const { applicant, applicationId, t } = await seedApplicationFixture();
		await t.run((ctx) => ctx.db.delete(applicationId));

		expect(
			await applicant.query(api.clubApplications.getApplication, { applicationId })
		).toBeNull();
	});

	it('lets an assigned Guide and an admin read the chat-page application info (no decide rights)', async () => {
		const { otherReviewer, otherReviewerProfileId, applicationId, t } =
			await seedApplicationFixture();
		await assignReviewer(t, applicationId, otherReviewerProfileId);
		const admin = await seedAdmin(t);
		const roomId = await t.run((ctx) =>
			ctx.db.insert('rooms', { contextType: 'clubApplication', clubApplicationId: applicationId })
		);

		const asAssigned = await otherReviewer.query(api.clubApplications.getApplicationForRoom, {
			roomId
		});
		expect(asAssigned).toMatchObject({ isApplicant: false, canDecide: false, hasReviewed: false });

		const asAdmin = await admin.query(api.clubApplications.getApplicationForRoom, { roomId });
		expect(asAdmin).toMatchObject({ isApplicant: false, canDecide: false, hasReviewed: false });
	});
});

// CL-690 CEO review item F: listMyApplications must carry the chat roomId so the no-club page can
// link straight to the chat instead of the generic chat list.
describe('listMyApplications', () => {
	it('reports a null roomId before the chat room exists, then the roomId once created', async () => {
		const { applicant, applicationId, t } = await seedApplicationFixture();

		const beforeRoom = await applicant.query(api.clubApplications.listMyApplications, {});
		expect(beforeRoom).toHaveLength(1);
		expect(beforeRoom[0]).toMatchObject({ _id: applicationId, roomId: null });

		const roomId = await t.run(async (ctx) => {
			const { ensureClubApplicationRoom } = await import('./chatModel');
			return await ensureClubApplicationRoom(ctx, applicationId);
		});

		const afterRoom = await applicant.query(api.clubApplications.listMyApplications, {});
		expect(afterRoom[0]).toMatchObject({ _id: applicationId, roomId });
	});
});

// Applicant-initiated support chat for an in-progress application (pre-submission), so someone
// stuck mid-wizard — e.g. on a failing video upload — can reach staff.
describe('ensureMyApplicationRoom', () => {
	it('creates the room for an incomplete application, idempotently, and the applicant can chat', async () => {
		const { applicant, applicationId, t } = await seedApplicationFixture();
		await t.run((ctx) => ctx.db.patch(applicationId, { status: 'incomplete' }));

		const first = await applicant.mutation(api.clubApplications.ensureMyApplicationRoom, {});
		const second = await applicant.mutation(api.clubApplications.ensureMyApplicationRoom, {});
		expect(second.roomId).toBe(first.roomId);

		const room = await t.run((ctx) => ctx.db.get(first.roomId));
		expect(room).toMatchObject({
			contextType: 'clubApplication',
			clubApplicationId: applicationId
		});

		const message = await applicant.mutation(api.chat.sendMessage, {
			roomId: first.roomId,
			content: 'My video upload keeps failing — help?'
		});
		expect(message?.content).toBe('My video upload keeps failing — help?');

		const summaries = await applicant.query(api.chat.listRoomSummaries, {});
		expect(summaries.some((summary: { roomId: string }) => summary.roomId === first.roomId)).toBe(
			true
		);
	});

	it('throws when the user has no incomplete application', async () => {
		// The fixture's application is 'pending' — submitted, not in progress.
		const { applicant } = await seedApplicationFixture();
		await expect(
			applicant.mutation(api.clubApplications.ensureMyApplicationRoom, {})
		).rejects.toThrow('No application in progress');
	});
});

// CL-695/725 CEO review items A and E: the chat member overview and the chat-list
// open/action-needed/closed badge for clubApplication rooms.
describe('clubApplication chat overview and action state', () => {
	it('lists the applicant and reviewers as participants, highlighting the applicant for a reviewer', async () => {
		const { reviewer, applicant, applicationId, reviewerProfileId, applicantProfileId, t } =
			await seedApplicationFixture();
		await addReview(t, applicationId, reviewerProfileId);
		const roomId = await t.run(async (ctx) => {
			const { ensureClubApplicationRoom } = await import('./chatModel');
			return await ensureClubApplicationRoom(ctx, applicationId);
		});

		const asReviewer = await reviewer.query(api.chat.getRoomParticipants, { roomId });
		expect(asReviewer.primaryProfileId).toBe(applicantProfileId);
		expect(asReviewer.participants).toContainEqual(
			expect.objectContaining({ profileId: applicantProfileId, roleLabel: 'Applicant' })
		);
		expect(asReviewer.participants).toContainEqual(
			expect.objectContaining({ profileId: reviewerProfileId, roleLabel: 'Reviewer' })
		);

		const asApplicant = await applicant.query(api.chat.getRoomParticipants, { roomId });
		expect(asApplicant.primaryProfileId).toBeNull();
	});

	it('flags actionState as action_needed for the deciding reviewer and open for the waiting applicant', async () => {
		const { reviewer, applicant, applicationId, reviewerProfileId, t } =
			await seedApplicationFixture();
		await addReview(t, applicationId, reviewerProfileId);
		const roomId = await t.run(async (ctx) => {
			const { ensureClubApplicationRoom } = await import('./chatModel');
			return await ensureClubApplicationRoom(ctx, applicationId);
		});
		// Move the application to the interview stage so the reviewer has an active decision to make.
		await moveToInterviewAsStaff(t, applicationId);

		const reviewerSummaries = await reviewer.query(api.chat.listRoomSummaries, {});
		const applicantSummaries = await applicant.query(api.chat.listRoomSummaries, {});

		expect(reviewerSummaries).toContainEqual(
			expect.objectContaining({ roomId, actionState: 'action_needed' })
		);
		expect(applicantSummaries).toContainEqual(
			expect.objectContaining({ roomId, actionState: 'open' })
		);
	});

	// CL-710 CEO review item 4: a decided application (accepted or rejected) is no longer 'closed'
	// — it reads as 'open' (sendable, nothing pending) for both the applicant and the reviewer.
	it('flags actionState as open (not closed) for both sides once rejected', async () => {
		const { reviewer, applicant, applicationId, reviewerProfileId, t } =
			await seedApplicationFixture();
		await addReview(t, applicationId, reviewerProfileId);
		const roomId = await t.run(async (ctx) => {
			const { ensureClubApplicationRoom } = await import('./chatModel');
			return await ensureClubApplicationRoom(ctx, applicationId);
		});
		await moveToInterviewAsStaff(t, applicationId);
		await reviewer.mutation(api.clubApplications.decideApplication, {
			applicationId,
			decision: 'rejected'
		});

		const applicantSummaries = await applicant.query(api.chat.listRoomSummaries, {});
		const reviewerSummaries = await reviewer.query(api.chat.listRoomSummaries, {});
		expect(applicantSummaries).toContainEqual(
			expect.objectContaining({ roomId, actionState: 'open' })
		);
		expect(reviewerSummaries).toContainEqual(
			expect.objectContaining({ roomId, actionState: 'open' })
		);
	});

	it('flags actionState as open (not action_needed) for the reviewer once accepted', async () => {
		const { reviewer, applicant, applicationId, reviewerProfileId, t } =
			await seedApplicationFixture();
		await addReview(t, applicationId, reviewerProfileId);
		const roomId = await t.run(async (ctx) => {
			const { ensureClubApplicationRoom } = await import('./chatModel');
			return await ensureClubApplicationRoom(ctx, applicationId);
		});
		await moveToInterviewAsStaff(t, applicationId);
		await reviewer.mutation(api.clubApplications.decideApplication, {
			applicationId,
			decision: 'accepted'
		});

		const applicantSummaries = await applicant.query(api.chat.listRoomSummaries, {});
		const reviewerSummaries = await reviewer.query(api.chat.listRoomSummaries, {});
		expect(applicantSummaries).toContainEqual(
			expect.objectContaining({ roomId, actionState: 'open' })
		);
		expect(reviewerSummaries).toContainEqual(
			expect.objectContaining({ roomId, actionState: 'open' })
		);
	});
});
