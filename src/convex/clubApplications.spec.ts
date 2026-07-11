/// <reference types="vite/client" />

import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { api } from './_generated/api';
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

	it('requires a review before moving to interview', async () => {
		const { otherReviewer, applicationId } = await seedApplicationFixture();
		await expect(
			otherReviewer.mutation(api.clubApplications.moveToInterview, { applicationId })
		).rejects.toThrow('Only a Guide who reviewed this application can do this');
	});

	it('moves to interview, creates the chat room, and notifies the applicant', async () => {
		const { reviewer, applicantProfileId, applicationId, t } = await setupReviewedApplication();

		await reviewer.mutation(api.clubApplications.moveToInterview, { applicationId });

		const application = await t.run((ctx) => ctx.db.get(applicationId));
		expect(application?.status).toBe('interview');
		expect(application?.movedToInterviewAt).toBeDefined();

		const room = await t.run((ctx) =>
			ctx.db
				.query('rooms')
				.withIndex('by_club_application_id', (q) => q.eq('clubApplicationId', applicationId))
				.first()
		);
		expect(room).not.toBeNull();

		const notifications = await t.run((ctx) =>
			ctx.db
				.query('notifications')
				.withIndex('by_profile', (q) => q.eq('profileId', applicantProfileId))
				.collect()
		);
		expect(notifications.some((n) => n.title === 'Your application moved to interview')).toBe(
			true
		);
	});

	it('rejects moving a non-pending application to interview', async () => {
		const { reviewer, applicationId } = await setupReviewedApplication();
		await reviewer.mutation(api.clubApplications.moveToInterview, { applicationId });
		await expect(
			reviewer.mutation(api.clubApplications.moveToInterview, { applicationId })
		).rejects.toThrow('Only applications in review can move to interview');
	});

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
		const { otherReviewer, reviewer, applicationId } = await setupReviewedApplication();
		await reviewer.mutation(api.clubApplications.moveToInterview, { applicationId });
		await expect(
			otherReviewer.mutation(api.clubApplications.decideApplication, {
				applicationId,
				decision: 'accepted'
			})
		).rejects.toThrow('Only a Guide who reviewed this application can do this');
	});

	it('accepts an application and notifies the applicant', async () => {
		const { reviewer, applicantProfileId, applicationId, t } = await setupReviewedApplication();
		await reviewer.mutation(api.clubApplications.moveToInterview, { applicationId });

		await reviewer.mutation(api.clubApplications.decideApplication, {
			applicationId,
			decision: 'accepted'
		});

		const application = await t.run((ctx) => ctx.db.get(applicationId));
		expect(application?.status).toBe('accepted');
		expect(application?.decidedByProfileId).toBeDefined();

		const notifications = await t.run((ctx) =>
			ctx.db
				.query('notifications')
				.withIndex('by_profile', (q) => q.eq('profileId', applicantProfileId))
				.collect()
		);
		expect(notifications.some((n) => n.title === 'Application accepted')).toBe(true);
	});

	it('rejects an application, posts the personal note and a system message, and notifies the applicant', async () => {
		const { reviewer, applicantProfileId, applicationId, t } = await setupReviewedApplication();
		await reviewer.mutation(api.clubApplications.moveToInterview, { applicationId });

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

	it('makes the chat read-only for the applicant once rejected', async () => {
		const { reviewer, applicant, applicationId, t } = await setupReviewedApplication();
		await reviewer.mutation(api.clubApplications.moveToInterview, { applicationId });
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
		expect(summaries).toContainEqual(
			expect.objectContaining({ roomId: room!._id, canSend: false })
		);
		await expect(
			applicant.mutation(api.chat.sendMessage, { roomId: room!._id, content: 'Still there?' })
		).rejects.toThrow('You can no longer send messages in this chat');
		await expect(
			applicant.query(api.chat.listMessages, { roomId: room!._id })
		).resolves.toBeDefined();
	});

	it('sets and requires the follow-up flag only while accepted', async () => {
		const { reviewer, applicationId } = await setupReviewedApplication();
		await expect(
			reviewer.mutation(api.clubApplications.setAdminFollowUpFlag, {
				applicationId,
				reason: 'No-show'
			})
		).rejects.toThrow('Only accepted applications awaiting onboarding can be flagged');

		await reviewer.mutation(api.clubApplications.moveToInterview, { applicationId });
		await reviewer.mutation(api.clubApplications.decideApplication, {
			applicationId,
			decision: 'accepted'
		});

		await reviewer.mutation(api.clubApplications.setAdminFollowUpFlag, {
			applicationId,
			reason: 'No-show / failed to schedule'
		});
	});

	it('confirms the onboarding call and finalizes the club, reusing the club-creation logic', async () => {
		const { reviewer, applicantProfileId, applicationId, t } = await setupReviewedApplication();
		await reviewer.mutation(api.clubApplications.moveToInterview, { applicationId });
		await reviewer.mutation(api.clubApplications.decideApplication, {
			applicationId,
			decision: 'accepted'
		});

		const result = await reviewer.mutation(api.clubApplications.confirmOnboardingCall, {
			applicationId
		});
		expect(result.clubId).toBeDefined();

		const application = await t.run((ctx) => ctx.db.get(applicationId));
		expect(application?.status).toBe('finalized');
		expect(application?.onboardingCallCompletedAt).toBeDefined();
		expect(application?.createdClubId).toBe(result.clubId);

		const applicantProfile = await t.run((ctx) => ctx.db.get(applicantProfileId));
		expect(applicantProfile?.activeClubId).toBe(result.clubId);

		const membership = await t.run((ctx) =>
			ctx.db
				.query('clubMembers')
				.withIndex('by_club_and_profile', (q) =>
					q.eq('clubId', result.clubId).eq('profileId', applicantProfileId)
				)
				.first()
		);
		expect(membership).not.toBeNull();

		const createdClub = await t.run((ctx) => ctx.db.get(result.clubId));
		expect(createdClub?.discoverable).toBe(true);
	});

	it('rejects confirming the onboarding call before acceptance', async () => {
		const { reviewer, applicationId } = await setupReviewedApplication();
		await reviewer.mutation(api.clubApplications.moveToInterview, { applicationId });
		await expect(
			reviewer.mutation(api.clubApplications.confirmOnboardingCall, { applicationId })
		).rejects.toThrow('The onboarding call can only be confirmed for accepted applications');
	});

	it('is idempotent when confirming the onboarding call twice', async () => {
		const { reviewer, applicationId } = await setupReviewedApplication();
		await reviewer.mutation(api.clubApplications.moveToInterview, { applicationId });
		await reviewer.mutation(api.clubApplications.decideApplication, {
			applicationId,
			decision: 'accepted'
		});
		const first = await reviewer.mutation(api.clubApplications.confirmOnboardingCall, {
			applicationId
		});
		const second = await reviewer.mutation(api.clubApplications.confirmOnboardingCall, {
			applicationId
		});
		expect(second.clubId).toBe(first.clubId);
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
		expect(asApplicant).toMatchObject({ isApplicant: true, canDecide: false, status: 'pending' });

		const asReviewer = await reviewer.query(api.clubApplications.getApplicationForRoom, {
			roomId
		});
		expect(asReviewer).toMatchObject({ isApplicant: false, canDecide: true, status: 'pending' });

		await expect(
			otherReviewer.query(api.clubApplications.getApplicationForRoom, { roomId })
		).rejects.toThrow('You cannot access this chat');
	});
});
