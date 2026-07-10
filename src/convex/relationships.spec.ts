/// <reference types="vite/client" />

import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

const seedSessionFixture = async () => {
	const t = convexTest(schema, modules);
	const ids = await t.run(async (ctx) => {
		const now = Date.now();
		const roleId = await ctx.db.insert('clubRoles', {
			key: 'guide',
			name: 'Guide',
			permissions: ['session_activity:update', 'attendance:create', 'project:update'],
			order: 0,
			createdAt: now
		});
		const profileId = await ctx.db.insert('profiles', {
			authUserId: 'guide-user',
			isVerified: true,
			firstLoginCompleted: true,
			updatedAt: now
		});
		const firstClubId = await ctx.db.insert('clubs', {
			name: 'First club',
			discoverable: false,
			createdByProfileId: profileId,
			createdAt: now,
			updatedAt: now
		});
		const secondClubId = await ctx.db.insert('clubs', {
			name: 'Second club',
			discoverable: false,
			createdByProfileId: profileId,
			createdAt: now,
			updatedAt: now
		});
		await ctx.db.insert('clubMembers', {
			clubId: firstClubId,
			profileId,
			roleId,
			createdAt: now
		});
		const firstSessionId = await ctx.db.insert('sessions', {
			clubId: firstClubId,
			startTime: now,
			endTime: now + 60_000,
			createdByProfileId: profileId,
			createdAt: now,
			updatedAt: now
		});
		const secondSessionId = await ctx.db.insert('sessions', {
			clubId: secondClubId,
			startTime: now,
			endTime: now + 60_000,
			createdByProfileId: profileId,
			createdAt: now,
			updatedAt: now
		});
		const secondSessionActivityId = await ctx.db.insert('sessionActivities', {
			sessionId: secondSessionId,
			name: 'Protected activity',
			createdByProfileId: profileId,
			createdAt: now,
			updatedAt: now
		});

		return { roleId, profileId, firstClubId, firstSessionId, secondSessionActivityId };
	});

	return {
		t: t.withIdentity({ subject: 'guide-user' }),
		...ids
	};
};

describe('relational integrity', () => {
	it('rejects updating an activity through a different session', async () => {
		const { t, firstSessionId, secondSessionActivityId } = await seedSessionFixture();

		await expect(
			t.mutation(api.sessions.upsertActivity, {
				sessionId: firstSessionId,
				activityId: secondSessionActivityId,
				name: 'Unauthorized edit'
			})
		).rejects.toThrow('Activity does not belong to this session');
	});

	it('rejects reordering activities from a different session', async () => {
		const { t, firstSessionId, secondSessionActivityId } = await seedSessionFixture();

		await expect(
			t.mutation(api.sessions.reorderActivities, {
				sessionId: firstSessionId,
				activityIds: [secondSessionActivityId]
			})
		).rejects.toThrow('Activity does not belong to this session');

		const activity = await t.run((ctx) => ctx.db.get(secondSessionActivityId));
		expect(activity?.order).toBeUndefined();
	});

	it('requires attendance profiles to be active members of the session club', async () => {
		const { t, firstSessionId } = await seedSessionFixture();
		const outsiderProfileId = await t.run((ctx) =>
			ctx.db.insert('profiles', {
				authUserId: 'outsider-user',
				isVerified: true,
				firstLoginCompleted: true,
				updatedAt: Date.now()
			})
		);

		await expect(
			t.mutation(api.sessions.setAttendance, {
				sessionId: firstSessionId,
				profileId: outsiderProfileId,
				status: 'present'
			})
		).rejects.toThrow('Attendee was not a club member when the session started');
	});

	it('stores attendance as a profile relationship', async () => {
		const { t, roleId, firstClubId, firstSessionId } = await seedSessionFixture();
		const learnerProfileId = await t.run(async (ctx) => {
			const profileId = await ctx.db.insert('profiles', {
				authUserId: 'learner-user',
				isVerified: true,
				firstLoginCompleted: true,
				updatedAt: Date.now()
			});
			// Join well before the fixture session's startTime (which is a `now` captured earlier)
			// so the attendance roster snapshot includes this member.
			await ctx.db.insert('clubMembers', {
				clubId: firstClubId,
				profileId,
				roleId,
				createdAt: 0
			});
			return profileId;
		});

		await t.mutation(api.sessions.setAttendance, {
			sessionId: firstSessionId,
			profileId: learnerProfileId,
			status: 'present'
		});

		const attendance = await t.run((ctx) =>
			ctx.db
				.query('attendances')
				.withIndex('by_session_and_profile', (q) =>
					q.eq('sessionId', firstSessionId).eq('profileId', learnerProfileId)
				)
				.unique()
		);
		expect(attendance?.profileId).toBe(learnerProfileId);
	});

	it('uses a stable role key for application review authorization and reviewer relationships', async () => {
		const t = convexTest(schema, modules);
		const ids = await t.run(async (ctx) => {
			const now = Date.now();
			const guideProfileId = await ctx.db.insert('profiles', {
				authUserId: 'guide-user',
				isVerified: true,
				firstLoginCompleted: true,
				updatedAt: now
			});
			const applicantProfileId = await ctx.db.insert('profiles', {
				authUserId: 'applicant-user',
				isVerified: true,
				firstLoginCompleted: true,
				updatedAt: now
			});
			const guideRoleId = await ctx.db.insert('clubRoles', {
				key: 'guide',
				name: 'Facilitator',
				permissions: [],
				order: 0,
				createdAt: now
			});
			const clubId = await ctx.db.insert('clubs', {
				name: 'Review club',
				discoverable: false,
				createdByProfileId: guideProfileId,
				createdAt: now,
				updatedAt: now
			});
			await ctx.db.insert('clubMembers', {
				clubId,
				profileId: guideProfileId,
				roleId: guideRoleId,
				createdAt: now
			});
			const applicationId = await ctx.db.insert('clubApplications', {
				applicantProfileId,
				status: 'pending',
				name: 'Applicant club',
				createdAt: now,
				updatedAt: now
			});
			const seasonId = await ctx.db.insert('seasons', {
				name: 'Test season',
				startDate: now,
				endDate: now + 1,
				reviewWindowOpen: now - 1,
				reviewWindowClose: now + 1,
				feedbackDeadline: now + 2,
				createdAt: now,
				updatedAt: now
			});
			await ctx.db.insert('applicationReviewAssignments', {
				applicationId,
				reviewerProfileId: guideProfileId,
				seasonId,
				assignedAt: now
			});
			return { guideProfileId, applicationId };
		});
		const guide = t.withIdentity({ subject: 'guide-user' });

		const reviewable = await guide.query(api.clubApplications.listReviewableApplications, {});
		expect(reviewable).toHaveLength(1);

		const result = await guide.mutation(api.clubApplications.upsertApplicationReview, {
			applicationId: ids.applicationId,
			principlesScore: 8,
			safetyScore: 8,
			note: 'Strong application'
		});
		const review = await t.run((ctx) => ctx.db.get(result.reviewId));
		expect(review?.reviewerProfileId).toBe(ids.guideProfileId);
	});

	it('adds project members through profile and role ids', async () => {
		const { t, profileId, firstClubId } = await seedSessionFixture();
		const ids = await t.run(async (ctx) => {
			const now = Date.now();
			const targetProfileId = await ctx.db.insert('profiles', {
				authUserId: 'project-member',
				isVerified: true,
				firstLoginCompleted: true,
				updatedAt: now
			});
			const projectRoleId = await ctx.db.insert('projectRoles', {
				key: 'contributor',
				name: 'Collaborator',
				permissions: [],
				order: 1,
				createdAt: now
			});
			const projectId = await ctx.db.insert('projects', {
				name: 'Relational project',
				dueDate: now + 60_000,
			visibility: 'clubs',
				createdByProfileId: profileId,
				createdAt: now,
				updatedAt: now
			});
			await ctx.db.insert('projectAttributions', {
				projectId,
				profileId,
				clubId: firstClubId,
				createdAt: now
			});
			return { targetProfileId, projectRoleId, projectId };
		});

		const member = await t.mutation(api.projects.addMember, {
			projectId: ids.projectId,
			profileId: ids.targetProfileId,
			roleId: ids.projectRoleId
		});
		expect(member?.profileId).toBe(ids.targetProfileId);
		expect(member?.roleId).toBe(ids.projectRoleId);
	});

	it('reuses a historical project membership keyed by profile id', async () => {
		const { t, profileId, firstClubId } = await seedSessionFixture();
		const ids = await t.run(async (ctx) => {
			const now = Date.now();
			const targetProfileId = await ctx.db.insert('profiles', {
				authUserId: 'returning-project-member',
				isVerified: true,
				firstLoginCompleted: true,
				updatedAt: now
			});
			const projectRoleId = await ctx.db.insert('projectRoles', {
				key: 'contributor',
				name: 'Collaborator',
				permissions: [],
				order: 1,
				createdAt: now
			});
			const projectId = await ctx.db.insert('projects', {
				name: 'Historical membership project',
				dueDate: now + 60_000,
			visibility: 'clubs',
				createdByProfileId: profileId,
				createdAt: now,
				updatedAt: now
			});
			await ctx.db.insert('projectAttributions', {
				projectId,
				profileId,
				clubId: firstClubId,
				createdAt: now
			});
			const historicalMembershipId = await ctx.db.insert('projectMembers', {
				projectId,
				profileId: targetProfileId,
				roleId: projectRoleId,
				leftAt: now,
				createdAt: now
			});
			return { targetProfileId, projectRoleId, projectId, historicalMembershipId };
		});

		const member = await t.mutation(api.projects.addMember, {
			projectId: ids.projectId,
			profileId: ids.targetProfileId,
			roleId: ids.projectRoleId
		});
		expect(member?._id).toBe(ids.historicalMembershipId);
		expect(member?.profileId).toBe(ids.targetProfileId);
		expect(member?.leftAt).toBeUndefined();
	});
});
