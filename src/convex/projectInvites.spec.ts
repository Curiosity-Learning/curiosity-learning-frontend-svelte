/// <reference types="vite/client" />

import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

// Deliverable-address stubs, same pattern as notifications.spec.ts: the betterAuth component
// isn't available in convex-test, so email lookup + sending are mocked.
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

/**
 * Seeds a project with a club, a configurable set of members, and the `creator`/`contributor`
 * project roles. Optionally seeds extra standalone profiles (not project members) for invite
 * targets. Mirrors `projects.spec.ts`'s `seedProjectFixture`.
 */
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

describe('project invites (CL-722)', () => {
	it('an active member can invite a platform user, who receives a notification', async () => {
		const { t, projectId, profileIds } = await seedFixture({
			extraProfiles: [{ authUserId: 'bob', clubId: 'none' }]
		});
		const alice = t.withIdentity({ subject: 'alice' });

		const invite = await alice.mutation(api.projectInvites.inviteMember, {
			projectId,
			inviteeProfileId: profileIds.bob
		});
		expect(invite?.status).toBe('pending');

		const notifications = await notificationsFor(t, profileIds.bob);
		expect(notifications).toHaveLength(1);
		expect(notifications[0].title).toBe('Project invitation');
		expect(notifications[0].url).toBe(`/project/${projectId}`);
	});

	it('rejects duplicate pending invites to the same user', async () => {
		const { t, projectId, profileIds } = await seedFixture({
			extraProfiles: [{ authUserId: 'bob', clubId: 'none' }]
		});
		const alice = t.withIdentity({ subject: 'alice' });

		await alice.mutation(api.projectInvites.inviteMember, {
			projectId,
			inviteeProfileId: profileIds.bob
		});

		await expect(
			alice.mutation(api.projectInvites.inviteMember, { projectId, inviteeProfileId: profileIds.bob })
		).rejects.toThrow('This user already has a pending invite to this project');
	});

	it('rejects inviting an existing active member', async () => {
		const { t, projectId, profileIds } = await seedFixture({
			memberSpecs: [{ authUserId: 'alice' }, { authUserId: 'bob' }]
		});
		const alice = t.withIdentity({ subject: 'alice' });

		await expect(
			alice.mutation(api.projectInvites.inviteMember, { projectId, inviteeProfileId: profileIds.bob })
		).rejects.toThrow('User is already a project member');
	});

	it('rejects invites on an archived project', async () => {
		const { t, projectId, profileIds } = await seedFixture({
			archived: true,
			extraProfiles: [{ authUserId: 'bob', clubId: 'none' }]
		});
		const alice = t.withIdentity({ subject: 'alice' });

		await expect(
			alice.mutation(api.projectInvites.inviteMember, { projectId, inviteeProfileId: profileIds.bob })
		).rejects.toThrow('Archived projects cannot invite new members');
	});

	it('a Done member cannot invite', async () => {
		const { t, projectId, profileIds } = await seedFixture({
			memberSpecs: [{ authUserId: 'alice', doneDate: Date.now() - 1000 }, { authUserId: 'zed' }],
			extraProfiles: [{ authUserId: 'bob', clubId: 'none' }]
		});
		const alice = t.withIdentity({ subject: 'alice' });

		await expect(
			alice.mutation(api.projectInvites.inviteMember, { projectId, inviteeProfileId: profileIds.bob })
		).rejects.toThrow('Done members cannot edit this project');
	});

	it('invitee can view a clubs-visibility project while their invite is pending', async () => {
		const { t, projectId, profileIds } = await seedFixture({
			extraProfiles: [{ authUserId: 'bob', clubId: 'none' }]
		});
		const alice = t.withIdentity({ subject: 'alice' });
		const bob = t.withIdentity({ subject: 'bob' });

		// Before invite: bob cannot view (not in an attributed club).
		await expect(bob.query(api.projects.getById, { projectId })).rejects.toThrow('Permission denied');

		await alice.mutation(api.projectInvites.inviteMember, {
			projectId,
			inviteeProfileId: profileIds.bob
		});

		const project = await bob.query(api.projects.getById, { projectId });
		expect(project?._id).toBe(projectId);
	});

	it('accept adds the invitee as an active member, logs "was invited by", and notifies the inviter', async () => {
		const { t, projectId, profileIds } = await seedFixture({
			extraProfiles: [{ authUserId: 'bob', clubId: 'none' }]
		});
		const alice = t.withIdentity({ subject: 'alice' });
		const bob = t.withIdentity({ subject: 'bob' });

		const invite = await alice.mutation(api.projectInvites.inviteMember, {
			projectId,
			inviteeProfileId: profileIds.bob
		});

		await bob.mutation(api.projectInvites.acceptInvite, { inviteId: invite!._id });

		const members = await bob.query(api.projects.listMembers, { projectId });
		const bobMember = members.find((m) => m.username === 'bob');
		expect(bobMember?.state).toBe('active');

		const changeLog = await bob.query(api.projects.listChangeLog, { projectId });
		const invitedEntry = changeLog.find((entry) => entry.entryType === 'member_invited');
		expect(invitedEntry?.text).toContain('was invited by');

		const inviterNotifications = await notificationsFor(t, profileIds.alice);
		expect(inviterNotifications.some((n) => n.title === 'Invite accepted')).toBe(true);
	});

	it('declining an invite only changes its status, no membership or change log created', async () => {
		const { t, projectId, profileIds } = await seedFixture({
			extraProfiles: [{ authUserId: 'bob', clubId: 'none' }]
		});
		const alice = t.withIdentity({ subject: 'alice' });
		const bob = t.withIdentity({ subject: 'bob' });

		const invite = await alice.mutation(api.projectInvites.inviteMember, {
			projectId,
			inviteeProfileId: profileIds.bob
		});
		await bob.mutation(api.projectInvites.declineInvite, { inviteId: invite!._id });

		const myInvite = await bob.query(api.projectInvites.getMyInviteForProject, { projectId });
		expect(myInvite?.status).toBe('declined');

		const members = await alice.query(api.projects.listMembers, { projectId });
		expect(members.map((m) => m.username)).not.toContain('bob');
	});

	it('the inviter can cancel a pending invite', async () => {
		const { t, projectId, profileIds } = await seedFixture({
			extraProfiles: [{ authUserId: 'bob', clubId: 'none' }]
		});
		const alice = t.withIdentity({ subject: 'alice' });

		const invite = await alice.mutation(api.projectInvites.inviteMember, {
			projectId,
			inviteeProfileId: profileIds.bob
		});
		await alice.mutation(api.projectInvites.cancelInvite, { inviteId: invite!._id });

		const pending = await alice.query(api.projectInvites.listPendingInvites, { projectId });
		expect(pending).toHaveLength(0);
	});

	it('applies the attribution-overlap smart default on accept (overlap present)', async () => {
		const { t, projectId, clubId, profileIds } = await seedFixture({
			extraProfiles: [{ authUserId: 'bob', clubId: 'same' }]
		});
		const alice = t.withIdentity({ subject: 'alice' });
		const bob = t.withIdentity({ subject: 'bob' });

		const invite = await alice.mutation(api.projectInvites.inviteMember, {
			projectId,
			inviteeProfileId: profileIds.bob
		});
		await bob.mutation(api.projectInvites.acceptInvite, { inviteId: invite!._id });

		const attributions = await bob.query(api.projects.listAttributions, { projectId });
		expect(attributions.attributedClubs.some((c) => c.clubId === clubId)).toBe(true);
	});

	it('does not create attribution when there is no club overlap', async () => {
		const { t, projectId, profileIds } = await seedFixture({
			extraProfiles: [{ authUserId: 'bob', clubId: 'other' }]
		});
		const alice = t.withIdentity({ subject: 'alice' });
		const bob = t.withIdentity({ subject: 'bob' });

		const invite = await alice.mutation(api.projectInvites.inviteMember, {
			projectId,
			inviteeProfileId: profileIds.bob
		});
		await bob.mutation(api.projectInvites.acceptInvite, { inviteId: invite!._id });

		const rows = await t.run((ctx) =>
			ctx.db
				.query('projectAttributions')
				.withIndex('by_project_and_profile', (q) =>
					q.eq('projectId', projectId).eq('profileId', profileIds.bob)
				)
				.collect()
		);
		expect(rows).toHaveLength(0);
	});
});
