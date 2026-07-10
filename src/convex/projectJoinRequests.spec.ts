/// <reference types="vite/client" />

import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

const { sendEmailMock, authEmailByUserId } = vi.hoisted(() => ({
	sendEmailMock: vi.fn(async () => {}),
	authEmailByUserId: new Map<string, string>([
		['alice', 'alice@example.com'],
		['bob', 'bob@example.com'],
		['carol', 'carol@example.com']
	])
}));

vi.mock('./email/resend', () => ({
	sendEmail: sendEmailMock
}));

vi.mock('./authEmail', () => ({
	getAuthUserEmail: async (_ctx: unknown, authUserId: string) =>
		authEmailByUserId.get(authUserId) ?? null
}));

beforeEach(() => {
	sendEmailMock.mockClear();
});

afterEach(() => {
	vi.useRealTimers();
});

const seedFixture = async (options?: {
	memberSpecs?: Array<{ authUserId: string; doneDate?: number; leftAt?: number }>;
	extraProfiles?: Array<{ authUserId: string; clubId?: 'same' | 'other' | 'none' }>;
	visibility?: 'clubs' | 'global';
	archived?: boolean;
}) => {
	const memberSpecs = options?.memberSpecs ?? [{ authUserId: 'alice' }];
	const t = convexTest(schema, modules);
	const ids = await t.run(async (ctx) => {
		const now = Date.now();
		const contributorRoleId = await ctx.db.insert('projectRoles', {
			key: 'contributor',
			name: 'Contributor',
			permissions: ['project:read', 'project:update'],
			order: 0,
			createdAt: now
		});
		const guideRoleId = await ctx.db.insert('clubRoles', {
			key: 'guide',
			name: 'Guide',
			permissions: ['project:read', 'project:create'],
			order: 0,
			createdAt: now
		});
		const learnerRoleId = await ctx.db.insert('clubRoles', {
			key: 'learner',
			name: 'Learner',
			permissions: ['project:read'],
			order: 1,
			createdAt: now
		});

		const profileIds: Record<string, Id<'profiles'>> = {};
		for (const spec of memberSpecs) {
			const profileId = await ctx.db.insert('profiles', {
				authUserId: spec.authUserId,
				username: spec.authUserId,
				isVerified: true,
				firstLoginCompleted: true,
				updatedAt: now
			});
			profileIds[spec.authUserId] = profileId;
		}

		const clubOwnerProfileId = profileIds[memberSpecs[0].authUserId];
		const clubId = await ctx.db.insert('clubs', {
			name: 'Fixture club',
			discoverable: false,
			createdByProfileId: clubOwnerProfileId,
			createdAt: now,
			updatedAt: now
		});
		await ctx.db.insert('clubMembers', {
			clubId,
			profileId: clubOwnerProfileId,
			roleId: guideRoleId,
			createdAt: now
		});

		const otherClubId = await ctx.db.insert('clubs', {
			name: 'Other club',
			discoverable: false,
			createdByProfileId: clubOwnerProfileId,
			createdAt: now,
			updatedAt: now
		});

		const projectId = await ctx.db.insert('projects', {
			name: 'Fixture project',
			dueDate: now + 7 * 24 * 60 * 60 * 1000,
			visibility: options?.visibility ?? 'clubs',
			archivedAt: options?.archived ? now : undefined,
			createdByProfileId: clubOwnerProfileId,
			createdAt: now,
			updatedAt: now
		});
		await ctx.db.insert('projectAttributions', {
			projectId,
			profileId: clubOwnerProfileId,
			clubId,
			createdAt: now
		});

		const memberIds: Record<string, Id<'projectMembers'>> = {};
		for (const spec of memberSpecs) {
			const memberId = await ctx.db.insert('projectMembers', {
				projectId,
				profileId: profileIds[spec.authUserId],
				roleId: contributorRoleId,
				doneDate: spec.doneDate,
				leftAt: spec.leftAt,
				firstName: spec.authUserId,
				username: spec.authUserId,
				createdAt: now
			});
			memberIds[spec.authUserId] = memberId;
		}

		for (const extra of options?.extraProfiles ?? []) {
			const profileId = await ctx.db.insert('profiles', {
				authUserId: extra.authUserId,
				username: extra.authUserId,
				isVerified: true,
				firstLoginCompleted: true,
				updatedAt: now
			});
			profileIds[extra.authUserId] = profileId;
			if (extra.clubId === 'same') {
				await ctx.db.insert('clubMembers', {
					clubId,
					profileId,
					roleId: learnerRoleId,
					createdAt: now
				});
			} else if (extra.clubId === 'other') {
				await ctx.db.insert('clubMembers', {
					clubId: otherClubId,
					profileId,
					roleId: learnerRoleId,
					createdAt: now
				});
			}
		}

		return { projectId, clubId, otherClubId, profileIds, memberIds };
	});

	return { t, ...ids };
};

const notificationsFor = (t: Awaited<ReturnType<typeof seedFixture>>['t'], profileId: Id<'profiles'>) =>
	t.run((ctx) =>
		ctx.db
			.query('notifications')
			.withIndex('by_profile', (q) => q.eq('profileId', profileId))
			.collect()
	);

describe('project join requests (CL-722)', () => {
	it('a club member who can view the project may request to join, notifying all active members', async () => {
		const { t, projectId, profileIds } = await seedFixture({
			memberSpecs: [{ authUserId: 'alice' }, { authUserId: 'carol' }],
			extraProfiles: [{ authUserId: 'bob', clubId: 'same' }]
		});
		const bob = t.withIdentity({ subject: 'bob' });

		const request = await bob.mutation(api.projectJoinRequests.requestToJoin, { projectId });
		expect(request?.status).toBe('pending');

		const aliceNotifications = await notificationsFor(t, profileIds.alice);
		const carolNotifications = await notificationsFor(t, profileIds.carol);
		expect(aliceNotifications.some((n) => n.title === 'New join request')).toBe(true);
		expect(carolNotifications.some((n) => n.title === 'New join request')).toBe(true);
	});

	it('a user who cannot view a clubs-visibility project cannot request to join', async () => {
		const { t, projectId } = await seedFixture({
			extraProfiles: [{ authUserId: 'bob', clubId: 'none' }]
		});
		const bob = t.withIdentity({ subject: 'bob' });

		await expect(bob.mutation(api.projectJoinRequests.requestToJoin, { projectId })).rejects.toThrow(
			'Permission denied'
		);
	});

	it('any authenticated user can request to join a globally-visible project', async () => {
		const { t, projectId } = await seedFixture({
			visibility: 'global',
			extraProfiles: [{ authUserId: 'bob', clubId: 'none' }]
		});
		const bob = t.withIdentity({ subject: 'bob' });

		const request = await bob.mutation(api.projectJoinRequests.requestToJoin, { projectId });
		expect(request?.status).toBe('pending');
	});

	it('rejects duplicate pending requests from the same user', async () => {
		const { t, projectId } = await seedFixture({
			extraProfiles: [{ authUserId: 'bob', clubId: 'same' }]
		});
		const bob = t.withIdentity({ subject: 'bob' });

		await bob.mutation(api.projectJoinRequests.requestToJoin, { projectId });
		await expect(bob.mutation(api.projectJoinRequests.requestToJoin, { projectId })).rejects.toThrow(
			'You already have a pending request to join this project'
		);
	});

	it('rejects requests on an archived project', async () => {
		const { t, projectId } = await seedFixture({
			archived: true,
			extraProfiles: [{ authUserId: 'bob', clubId: 'same' }]
		});
		const bob = t.withIdentity({ subject: 'bob' });

		await expect(bob.mutation(api.projectJoinRequests.requestToJoin, { projectId })).rejects.toThrow(
			'Archived projects cannot accept join requests'
		);
	});

	it('rejects a request from an existing active member', async () => {
		const { t, projectId } = await seedFixture({
			memberSpecs: [{ authUserId: 'alice' }, { authUserId: 'bob' }]
		});
		const bob = t.withIdentity({ subject: 'bob' });

		await expect(bob.mutation(api.projectJoinRequests.requestToJoin, { projectId })).rejects.toThrow(
			'You are already a project member'
		);
	});

	it('any active member can accept a request; requester becomes an active member and change log records "joined the project"', async () => {
		const { t, projectId, profileIds } = await seedFixture({
			memberSpecs: [{ authUserId: 'alice' }],
			extraProfiles: [{ authUserId: 'bob', clubId: 'same' }]
		});
		const alice = t.withIdentity({ subject: 'alice' });
		const bob = t.withIdentity({ subject: 'bob' });

		const request = await bob.mutation(api.projectJoinRequests.requestToJoin, { projectId });
		await alice.mutation(api.projectJoinRequests.acceptRequest, { requestId: request!._id });

		const members = await alice.query(api.projects.listMembers, { projectId });
		const bobMember = members.find((m) => m.username === 'bob');
		expect(bobMember?.state).toBe('active');

		const changeLog = await alice.query(api.projects.listChangeLog, { projectId });
		const joinedEntry = changeLog.find(
			(entry) => entry.entryType === 'member_joined' && entry.text.includes('bob')
		);
		expect(joinedEntry?.text).toBe('bob joined the project');

		const bobNotifications = await notificationsFor(t, profileIds.bob);
		expect(bobNotifications.some((n) => n.title === 'Join request accepted')).toBe(true);
	});

	it('a Done member cannot accept a request', async () => {
		const { t, projectId } = await seedFixture({
			memberSpecs: [{ authUserId: 'alice', doneDate: Date.now() - 1000 }, { authUserId: 'zed' }],
			extraProfiles: [{ authUserId: 'bob', clubId: 'same' }]
		});
		const alice = t.withIdentity({ subject: 'alice' });
		const bob = t.withIdentity({ subject: 'bob' });

		const request = await bob.mutation(api.projectJoinRequests.requestToJoin, { projectId });
		await expect(
			alice.mutation(api.projectJoinRequests.acceptRequest, { requestId: request!._id })
		).rejects.toThrow('Permission denied');
	});

	it('any active member can decline a request; requester is notified', async () => {
		const { t, projectId, profileIds } = await seedFixture({
			extraProfiles: [{ authUserId: 'bob', clubId: 'same' }]
		});
		const alice = t.withIdentity({ subject: 'alice' });
		const bob = t.withIdentity({ subject: 'bob' });

		const request = await bob.mutation(api.projectJoinRequests.requestToJoin, { projectId });
		await alice.mutation(api.projectJoinRequests.declineRequest, { requestId: request!._id });

		const bobNotifications = await notificationsFor(t, profileIds.bob);
		expect(bobNotifications.some((n) => n.title === 'Join request declined')).toBe(true);

		const members = await alice.query(api.projects.listMembers, { projectId });
		expect(members.map((m) => m.username)).not.toContain('bob');
	});

	it('the requester can cancel their own pending request', async () => {
		const { t, projectId } = await seedFixture({
			extraProfiles: [{ authUserId: 'bob', clubId: 'same' }]
		});
		const bob = t.withIdentity({ subject: 'bob' });

		const request = await bob.mutation(api.projectJoinRequests.requestToJoin, { projectId });
		await bob.mutation(api.projectJoinRequests.cancelRequest, { requestId: request!._id });

		const myRequest = await bob.query(api.projectJoinRequests.getMyRequestForProject, { projectId });
		expect(myRequest?.status).toBe('cancelled');
	});

	it('applies the attribution-overlap smart default on accept', async () => {
		const { t, projectId, clubId } = await seedFixture({
			extraProfiles: [{ authUserId: 'bob', clubId: 'same' }]
		});
		const alice = t.withIdentity({ subject: 'alice' });
		const bob = t.withIdentity({ subject: 'bob' });

		const request = await bob.mutation(api.projectJoinRequests.requestToJoin, { projectId });
		await alice.mutation(api.projectJoinRequests.acceptRequest, { requestId: request!._id });

		const attributions = await bob.query(api.projects.listAttributions, { projectId });
		expect(attributions.attributedClubs.some((c) => c.clubId === clubId)).toBe(true);
	});
});
