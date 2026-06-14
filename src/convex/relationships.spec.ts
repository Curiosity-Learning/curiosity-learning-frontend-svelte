/// <reference types="vite/client" />

import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { api, internal } from './_generated/api';
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
			createdByProfileId: profileId,
			createdAt: now,
			updatedAt: now
		});
		const secondClubId = await ctx.db.insert('clubs', {
			name: 'Second club',
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
				attending: true
			})
		).rejects.toThrow('Attendee must be an active club member');
	});

	it('stores attendance as a profile relationship without a duplicate auth user id', async () => {
		const { t, roleId, firstClubId, firstSessionId } = await seedSessionFixture();
		const learnerProfileId = await t.run(async (ctx) => {
			const profileId = await ctx.db.insert('profiles', {
				authUserId: 'learner-user',
				isVerified: true,
				firstLoginCompleted: true,
				updatedAt: Date.now()
			});
			await ctx.db.insert('clubMembers', {
				clubId: firstClubId,
				profileId,
				roleId,
				createdAt: Date.now()
			});
			return profileId;
		});

		await t.mutation(api.sessions.setAttendance, {
			sessionId: firstSessionId,
			profileId: learnerProfileId,
			attending: true
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
		expect(attendance?.userId).toBeUndefined();
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
			return { guideProfileId, applicationId };
		});
		const guide = t.withIdentity({ subject: 'guide-user' });

		const reviewable = await guide.query(api.clubApplications.listReviewableApplications, {});
		expect(reviewable).toHaveLength(1);

		const result = await guide.mutation(api.clubApplications.upsertApplicationReview, {
			applicationId: ids.applicationId,
			score: 8,
			note: 'Strong application'
		});
		const review = await t.run((ctx) => ctx.db.get(result.reviewId));
		expect(review?.reviewerProfileId).toBe(ids.guideProfileId);
		expect(review?.reviewerUserId).toBeUndefined();
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
				createdByProfileId: profileId,
				createdAt: now,
				updatedAt: now
			});
			await ctx.db.insert('projectClubs', {
				projectId,
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
		expect(member?.userId).toBeUndefined();
	});

	it('reuses and migrates a historical legacy project membership', async () => {
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
				createdByProfileId: profileId,
				createdAt: now,
				updatedAt: now
			});
			await ctx.db.insert('projectClubs', {
				projectId,
				clubId: firstClubId,
				createdAt: now
			});
			const historicalMembershipId = await ctx.db.insert('projectMembers', {
				projectId,
				userId: 'returning-project-member',
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
		expect(member?.userId).toBeUndefined();
		expect(member?.leftAt).toBeUndefined();
	});

	it('creates direct rooms with profile relationships from legacy club membership rows', async () => {
		const t = convexTest(schema, modules);
		const ids = await t.run(async (ctx) => {
			const now = Date.now();
			const viewerProfileId = await ctx.db.insert('profiles', {
				authUserId: 'chat-viewer',
				isVerified: true,
				firstLoginCompleted: true,
				updatedAt: now
			});
			const otherProfileId = await ctx.db.insert('profiles', {
				authUserId: 'chat-other',
				isVerified: true,
				firstLoginCompleted: true,
				updatedAt: now
			});
			const clubId = await ctx.db.insert('clubs', {
				name: 'Chat club',
				createdByProfileId: viewerProfileId,
				createdAt: now,
				updatedAt: now
			});
			await ctx.db.patch(viewerProfileId, { activeClubId: clubId });
			const roleId = await ctx.db.insert('clubRoles', {
				key: 'learner',
				name: 'Learner',
				permissions: [],
				order: 1,
				createdAt: now
			});
			await ctx.db.insert('clubMembers', {
				clubId,
				userId: 'chat-other',
				roleId,
				createdAt: now
			});
			return { viewerProfileId, otherProfileId };
		});
		const viewer = t.withIdentity({ subject: 'chat-viewer' });

		const room = await viewer.mutation(api.chat.getOrCreateDirectRoom, {
			otherProfileId: ids.otherProfileId
		});
		expect(new Set([room?.directProfileAId, room?.directProfileBId])).toEqual(
			new Set([ids.viewerProfileId, ids.otherProfileId])
		);
		expect(room?.directKey).toBeUndefined();

		const participants = await t.run((ctx) =>
			ctx.db
				.query('participants')
				.withIndex('by_room', (q) => q.eq('roomId', room!._id))
				.collect()
		);
		expect(participants).toHaveLength(2);
		expect(participants.every((participant) => participant.profileId && !participant.userId)).toBe(
			true
		);
	});

	it('keeps the sender read state correct in legacy chat rooms', async () => {
		const t = convexTest(schema, modules);
		const ids = await t.run(async (ctx) => {
			const now = Date.now();
			const viewerProfileId = await ctx.db.insert('profiles', {
				authUserId: 'legacy-chat-viewer',
				isVerified: true,
				firstLoginCompleted: true,
				updatedAt: now
			});
			await ctx.db.insert('profiles', {
				authUserId: 'legacy-chat-other',
				isVerified: true,
				firstLoginCompleted: true,
				updatedAt: now
			});
			const roomId = await ctx.db.insert('rooms', {
				isGroupChat: false,
				directKey: 'legacy-chat-other|legacy-chat-viewer',
				createdAt: now
			});
			const viewerParticipantId = await ctx.db.insert('participants', {
				roomId,
				userId: 'legacy-chat-viewer',
				isAdmin: true,
				unreadCount: 4,
				createdAt: now
			});
			const otherParticipantId = await ctx.db.insert('participants', {
				roomId,
				userId: 'legacy-chat-other',
				isAdmin: false,
				unreadCount: 2,
				createdAt: now
			});
			return { viewerProfileId, roomId, viewerParticipantId, otherParticipantId };
		});
		const viewer = t.withIdentity({ subject: 'legacy-chat-viewer' });

		const message = await viewer.mutation(api.chat.sendMessage, {
			roomId: ids.roomId,
			content: 'Legacy-compatible message'
		});
		const participants = await t.run(async (ctx) => ({
			viewer: await ctx.db.get(ids.viewerParticipantId),
			other: await ctx.db.get(ids.otherParticipantId)
		}));

		expect(message?.profileId).toBe(ids.viewerProfileId);
		expect(message?.userId).toBeUndefined();
		expect(participants.viewer?.unreadCount).toBe(0);
		expect(participants.other?.unreadCount).toBe(3);
	});

	it('backfills relationships from a retired auth user id without changing the current profile auth id', async () => {
		const t = convexTest(schema, modules);
		const ids = await t.run(async (ctx) => {
			const now = Date.now();
			const profileId = await ctx.db.insert('profiles', {
				authUserId: 'current-auth-user',
				isVerified: true,
				firstLoginCompleted: true,
				updatedAt: now
			});
			const projectId = await ctx.db.insert('projects', {
				name: 'Retired auth relationship',
				dueDate: now + 60_000,
				createdByUserId: 'retired-auth-user',
				createdAt: now,
				updatedAt: now
			});
			const roleId = await ctx.db.insert('projectRoles', {
				key: 'creator',
				name: 'Creator',
				permissions: [],
				order: 0,
				createdAt: now
			});
			const memberId = await ctx.db.insert('projectMembers', {
				projectId,
				userId: 'retired-auth-user',
				roleId,
				createdAt: now
			});
			const preferenceId = await ctx.db.insert('userPreferences', {
				userId: 'retired-auth-user',
				theme: 'system',
				notificationsEnabled: true,
				notificationPreferences: {
					clubMemberChanges: true,
					projectDeadlineReminder: true,
					projectMemberAdded: true,
					projectCompleted: true,
					sessionReminder: true,
					sessionActivityChanges: true,
					updateLikes: true,
					updateComments: true,
					chatMessages: true
				},
				updatedAt: now
			});
			return { profileId, projectId, memberId, preferenceId };
		});

		const result = await t.mutation(internal.migrations.backfillRetiredAuthUserRelationships, {
			retiredAuthUserId: 'retired-auth-user',
			profileId: ids.profileId
		});
		const migrated = await t.run(async (ctx) => ({
			profile: await ctx.db.get(ids.profileId),
			project: await ctx.db.get(ids.projectId),
			member: await ctx.db.get(ids.memberId),
			preference: await ctx.db.get(ids.preferenceId)
		}));

		expect(result.relationshipsMigrated).toBe(3);
		expect(migrated.profile?.authUserId).toBe('current-auth-user');
		expect(migrated.project?.createdByProfileId).toBe(ids.profileId);
		expect(migrated.project?.createdByUserId).toBeUndefined();
		expect(migrated.member?.profileId).toBe(ids.profileId);
		expect(migrated.member?.userId).toBeUndefined();
		expect(migrated.preference?.profileId).toBe(ids.profileId);
		expect(migrated.preference?.userId).toBeUndefined();
	});

	it('backfills legacy person relationships and stable role keys', async () => {
		const t = convexTest(schema, modules);
		const ids = await t.run(async (ctx) => {
			const now = Date.now();
			const profileId = await ctx.db.insert('profiles', {
				userId: 'legacy-user',
				isVerified: true,
				firstLoginCompleted: true,
				updatedAt: now
			});
			const roleId = await ctx.db.insert('clubRoles', {
				name: 'Guide',
				permissions: [],
				order: 0,
				createdAt: now
			});
			const clubId = await ctx.db.insert('clubs', {
				name: 'Legacy club',
				createdByUserId: 'legacy-user',
				createdAt: now,
				updatedAt: now
			});
			const membershipId = await ctx.db.insert('clubMembers', {
				clubId,
				userId: 'legacy-user',
				roleId,
				createdAt: now
			});
			const sessionId = await ctx.db.insert('sessions', {
				clubId,
				startTime: now,
				endTime: now + 60_000,
				createdByUserId: 'legacy-user',
				createdAt: now,
				updatedAt: now
			});
			const attendanceId = await ctx.db.insert('attendances', {
				sessionId,
				userId: 'legacy-user',
				createdByUserId: 'legacy-user',
				createdAt: now
			});
			return { profileId, roleId, clubId, membershipId, attendanceId };
		});

		await t.mutation(internal.roles.backfillStableKeys, {});
		await t.mutation(internal.migrations.backfillProfileRelationships, {
			paginationOpts: { numItems: 10, cursor: null }
		});

		const result = await t.run(async (ctx) => ({
			profile: await ctx.db.get(ids.profileId),
			role: await ctx.db.get(ids.roleId),
			club: await ctx.db.get(ids.clubId),
			membership: await ctx.db.get(ids.membershipId),
			attendance: await ctx.db.get(ids.attendanceId)
		}));
		expect(result.profile?.authUserId).toBe('legacy-user');
		expect(result.profile?.userId).toBeUndefined();
		expect(result.role?.key).toBe('guide');
		expect(result.club?.createdByProfileId).toBe(ids.profileId);
		expect(result.club?.createdByUserId).toBeUndefined();
		expect(result.membership?.profileId).toBe(ids.profileId);
		expect(result.membership?.userId).toBeUndefined();
		expect(result.attendance?.profileId).toBe(ids.profileId);
		expect(result.attendance?.createdByProfileId).toBe(ids.profileId);
		expect(result.attendance?.userId).toBeUndefined();
		expect(result.attendance?.createdByUserId).toBeUndefined();
	});
});
