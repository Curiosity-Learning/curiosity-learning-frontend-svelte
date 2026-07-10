/// <reference types="vite/client" />

import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

/**
 * Seeds a project with a club link and a configurable set of members. Each member gets a
 * profile + projectMembers row; the first member is the project creator. Returns handles keyed
 * by the member's `authUserId` for convenient `t.withIdentity(...)` calls in tests.
 */
const seedProjectFixture = async (
	memberSpecs: Array<{ authUserId: string; doneDate?: number; leftAt?: number }>
) => {
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

		const profileIds: Record<string, string> = {};
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
			createdByProfileId: clubOwnerProfileId as never,
			createdAt: now,
			updatedAt: now
		});
		await ctx.db.insert('clubMembers', {
			clubId,
			profileId: clubOwnerProfileId as never,
			roleId: guideRoleId,
			createdAt: now
		});

		const projectId = await ctx.db.insert('projects', {
			name: 'Fixture project',
			dueDate: now + 7 * 24 * 60 * 60 * 1000,
			visibility: 'clubs',
			createdByProfileId: clubOwnerProfileId as never,
			createdAt: now,
			updatedAt: now
		});
		await ctx.db.insert('projectClubs', { projectId, clubId, createdAt: now });

		const memberIds: Record<string, string> = {};
		for (const spec of memberSpecs) {
			const memberId = await ctx.db.insert('projectMembers', {
				projectId,
				profileId: profileIds[spec.authUserId] as never,
				roleId: contributorRoleId,
				doneDate: spec.doneDate,
				leftAt: spec.leftAt,
				createdAt: now
			});
			memberIds[spec.authUserId] = memberId;
		}

		return { projectId, clubId, profileIds, memberIds };
	});

	return { t, ...ids };
};

describe('project member lifecycle (CL-723)', () => {
	it('markSelfDone is permanent and has no undo mutation', async () => {
		const { t, projectId } = await seedProjectFixture([
			{ authUserId: 'alice' },
			{ authUserId: 'bob' }
		]);
		const alice = t.withIdentity({ subject: 'alice' });

		const result = await alice.mutation(api.projects.markSelfDone, { projectId });
		expect(result.archived).toBe(false);

		await expect(alice.mutation(api.projects.markSelfDone, { projectId })).rejects.toThrow(
			'You have already marked this project as done'
		);

		expect('unmarkSelfDone' in api.projects).toBe(false);

		const members = await alice.query(api.projects.listMembers, { projectId });
		const aliceMember = members.find((m) => m.username === 'alice');
		expect(aliceMember?.state).toBe('done');
		expect(aliceMember?.doneDate).toEqual(expect.any(Number));
	});

	it('archives the project and stamps archivedAt when the last active member marks done, and writes change log entries', async () => {
		const { t, projectId } = await seedProjectFixture([
			{ authUserId: 'alice', doneDate: Date.now() - 1000 },
			{ authUserId: 'bob' }
		]);
		const bob = t.withIdentity({ subject: 'bob' });

		const result = await bob.mutation(api.projects.markSelfDone, { projectId });
		expect(result.archived).toBe(true);

		const project = await bob.query(api.projects.getById, { projectId });
		expect(project?.archivedAt).toEqual(expect.any(Number));

		const changeLog = await bob.query(api.projects.listChangeLog, { projectId });
		const entryTypes = changeLog.map((entry) => entry.entryType);
		expect(entryTypes).toContain('project_archived');
		expect(entryTypes.filter((type) => type === 'member_done').length).toBeGreaterThanOrEqual(1);

		const archivedEntry = changeLog.find((entry) => entry.entryType === 'project_archived');
		expect(archivedEntry?.actorProfileId).toBeUndefined();
		expect(archivedEntry?.text).toBe('Project archived');
	});

	it('does not re-stamp archivedAt or duplicate the archived change log if already archived', async () => {
		const { t, projectId } = await seedProjectFixture([{ authUserId: 'alice' }]);
		const alice = t.withIdentity({ subject: 'alice' });

		await alice.mutation(api.projects.markSelfDone, { projectId });
		const firstArchivedAt = (await alice.query(api.projects.getById, { projectId }))?.archivedAt;

		const changeLogAfterFirst = await alice.query(api.projects.listChangeLog, { projectId });
		const archivedCount = changeLogAfterFirst.filter(
			(entry) => entry.entryType === 'project_archived'
		).length;
		expect(archivedCount).toBe(1);
		expect(firstArchivedAt).toEqual(expect.any(Number));
	});

	it('leaveProject sets leftAt, removes the member from listMembers, and logs the departure', async () => {
		const { t, projectId } = await seedProjectFixture([
			{ authUserId: 'alice' },
			{ authUserId: 'bob' }
		]);
		const alice = t.withIdentity({ subject: 'alice' });
		const bob = t.withIdentity({ subject: 'bob' });

		await bob.mutation(api.projects.leaveProject, { projectId });

		// Bob has left and holds no club role, so he can no longer read the project; verify the
		// effects from Alice's (still-a-member) perspective instead.
		const members = await alice.query(api.projects.listMembers, { projectId });
		expect(members.map((m) => m.username)).not.toContain('bob');

		const changeLog = await alice.query(api.projects.listChangeLog, { projectId });
		expect(changeLog.some((entry) => entry.entryType === 'member_left')).toBe(true);
	});

	it('a Done member cannot edit project metadata', async () => {
		const { t, projectId } = await seedProjectFixture([{ authUserId: 'alice' }]);
		const alice = t.withIdentity({ subject: 'alice' });

		await alice.mutation(api.projects.markSelfDone, { projectId });

		await expect(
			alice.mutation(api.projects.update, { projectId, name: 'New name' })
		).rejects.toThrow('Done members cannot edit this project');
	});

	it('a Done member cannot post project updates', async () => {
		const { t, projectId } = await seedProjectFixture([{ authUserId: 'alice' }]);
		const alice = t.withIdentity({ subject: 'alice' });

		await alice.mutation(api.projects.markSelfDone, { projectId });

		await expect(
			alice.mutation(api.updates.create, { projectId, content: 'Should be blocked' })
		).rejects.toThrow('Done members cannot edit this project');
	});

	it('re-adding a previously-left member clears leftAt and doneDate on the same row', async () => {
		const { t, projectId, memberIds } = await seedProjectFixture([
			{ authUserId: 'alice' },
			{ authUserId: 'bob', doneDate: Date.now() - 5000, leftAt: Date.now() - 1000 }
		]);
		const alice = t.withIdentity({ subject: 'alice' });

		const contributorRoleId = await t.run(async (ctx) => {
			const role = await ctx.db
				.query('projectRoles')
				.withIndex('by_key', (q) => q.eq('key', 'contributor'))
				.unique();
			return role!._id;
		});
		const bobProfileId = await t.run(async (ctx) => {
			const member = await ctx.db.get(memberIds.bob as never);
			return (member as { profileId: string }).profileId;
		});

		const readded = await alice.mutation(api.projects.addMember, {
			projectId,
			profileId: bobProfileId as never,
			roleId: contributorRoleId
		});

		expect(readded?._id).toBe(memberIds.bob);
		expect(readded?.leftAt).toBeUndefined();
		expect(readded?.doneDate).toBeUndefined();

		const changeLog = await alice.query(api.projects.listChangeLog, { projectId });
		expect(changeLog.some((entry) => entry.entryType === 'member_joined')).toBe(true);

		const members = await alice.query(api.projects.listMembers, { projectId });
		const bobMember = members.find((m) => m.username === 'bob');
		expect(bobMember?.state).toBe('active');
	});

	it('removeMember mutation no longer exists', () => {
		expect('removeMember' in api.projects).toBe(false);
	});
});

describe('project visibility (CL-718)', () => {
	it('a "global" project is readable by any authenticated user, even non-members', async () => {
		const { t, projectId } = await seedProjectFixture([{ authUserId: 'alice' }]);
		await t.run(async (ctx) => {
			await ctx.db.patch(projectId, { visibility: 'global' });
		});

		const stranger = t.withIdentity({ subject: 'stranger' });
		await t.run(async (ctx) => {
			await ctx.db.insert('profiles', {
				authUserId: 'stranger',
				username: 'stranger',
				isVerified: true,
				firstLoginCompleted: true,
				updatedAt: Date.now()
			});
		});

		const project = await stranger.query(api.projects.getById, { projectId });
		expect(project?._id).toBe(projectId);
	});

	it('a "clubs" project is not readable by a non-member of any attributed club', async () => {
		const { t, projectId } = await seedProjectFixture([{ authUserId: 'alice' }]);

		await t.run(async (ctx) => {
			await ctx.db.insert('profiles', {
				authUserId: 'stranger',
				username: 'stranger',
				isVerified: true,
				firstLoginCompleted: true,
				updatedAt: Date.now()
			});
		});
		const stranger = t.withIdentity({ subject: 'stranger' });

		await expect(stranger.query(api.projects.getById, { projectId })).rejects.toThrow(
			'Permission denied'
		);
	});

	it('a "clubs" project is readable by a member of an attributed club who is not a project member', async () => {
		const { t, projectId, clubId } = await seedProjectFixture([{ authUserId: 'alice' }]);

		const learnerRoleId = await t.run(async (ctx) => {
			const now = Date.now();
			const roleId = await ctx.db.insert('clubRoles', {
				key: 'learner',
				name: 'Learner',
				permissions: ['project:read'],
				order: 1,
				createdAt: now
			});
			const profileId = await ctx.db.insert('profiles', {
				authUserId: 'clubmate',
				username: 'clubmate',
				isVerified: true,
				firstLoginCompleted: true,
				updatedAt: now
			});
			await ctx.db.insert('clubMembers', {
				clubId,
				profileId,
				roleId,
				createdAt: now
			});
			return roleId;
		});
		expect(learnerRoleId).toBeTruthy();

		const clubmate = t.withIdentity({ subject: 'clubmate' });
		const project = await clubmate.query(api.projects.getById, { projectId });
		expect(project?._id).toBe(projectId);
	});

	it('a "clubs" project remains readable by its own (even left/done) members regardless of club standing', async () => {
		const { t, projectId } = await seedProjectFixture([
			{ authUserId: 'alice' },
			{ authUserId: 'bob', leftAt: Date.now() - 1000 }
		]);

		const bob = t.withIdentity({ subject: 'bob' });
		const project = await bob.query(api.projects.getById, { projectId });
		expect(project?._id).toBe(projectId);
	});

	it('any active member can toggle visibility, and it is logged in the change log', async () => {
		const { t, projectId } = await seedProjectFixture([{ authUserId: 'alice' }]);
		const alice = t.withIdentity({ subject: 'alice' });

		const updated = await alice.mutation(api.projects.update, {
			projectId,
			visibility: 'global'
		});
		expect(updated?.visibility).toBe('global');

		const changeLog = await alice.query(api.projects.listChangeLog, { projectId });
		const entry = changeLog.find((e) => e.entryType === 'visibility_changed');
		expect(entry?.text).toContain('Share Globally');
	});
});

describe('project editing rights are collective, not creator-special (CL-718)', () => {
	it('a non-member cannot edit the project', async () => {
		const { t, projectId } = await seedProjectFixture([{ authUserId: 'alice' }]);
		await t.run(async (ctx) => {
			await ctx.db.insert('profiles', {
				authUserId: 'stranger',
				username: 'stranger',
				isVerified: true,
				firstLoginCompleted: true,
				updatedAt: Date.now()
			});
		});
		const stranger = t.withIdentity({ subject: 'stranger' });

		await expect(
			stranger.mutation(api.projects.update, { projectId, name: 'Hijacked' })
		).rejects.toThrow('Permission denied');
	});

	it('a Done member cannot edit even though they were the creator', async () => {
		const { t, projectId } = await seedProjectFixture([{ authUserId: 'alice' }]);
		const alice = t.withIdentity({ subject: 'alice' });

		await alice.mutation(api.projects.markSelfDone, { projectId });

		await expect(
			alice.mutation(api.projects.update, { projectId, name: 'New name' })
		).rejects.toThrow('Done members cannot edit this project');
	});

	it('a non-creator active member can edit exactly like the creator', async () => {
		const { t, projectId } = await seedProjectFixture([
			{ authUserId: 'alice' },
			{ authUserId: 'bob' }
		]);
		const bob = t.withIdentity({ subject: 'bob' });

		const updated = await bob.mutation(api.projects.update, {
			projectId,
			name: 'Renamed by non-creator'
		});
		expect(updated?.name).toBe('Renamed by non-creator');
	});
});

describe('project metadata change log (CL-718)', () => {
	it('logs a change-log entry for each of name, description, deadline, visibility, and cover', async () => {
		const { t, projectId } = await seedProjectFixture([{ authUserId: 'alice' }]);
		const alice = t.withIdentity({ subject: 'alice' });

		const assetId = await t.run(async (ctx) => {
			const now = Date.now();
			return await ctx.db.insert('mediaAssets', {
				ownerUserId: 'alice',
				mediaKind: 'image',
				status: 'ready',
				acceptedContentTypes: ['image/jpeg'],
				maxBytes: 10_000_000,
				enableCompression: true,
				enableSafetyScreening: true,
				storageProvider: 's3',
				sourceBucket: 'test-bucket',
				sourceObjectKey: 'test-object-key',
				sourceObjectRevision: 1,
				contentType: 'image/jpeg',
				sizeBytes: 1000,
				pipelineVersion: 1,
				attemptCount: 1,
				stepResults: [],
				createdAt: now,
				updatedAt: now,
				readyAt: now
			});
		});

		await alice.mutation(api.projects.update, {
			projectId,
			name: 'New name',
			description: 'New description',
			dueDate: Date.now() + 30 * 24 * 60 * 60 * 1000,
			visibility: 'global',
			coverImageMediaAssetId: assetId
		});

		const changeLog = await alice.query(api.projects.listChangeLog, { projectId });
		const entryTypes = changeLog.map((entry) => entry.entryType);
		expect(entryTypes).toContain('name_changed');
		expect(entryTypes).toContain('description_changed');
		expect(entryTypes).toContain('deadline_changed');
		expect(entryTypes).toContain('visibility_changed');
		expect(entryTypes).toContain('cover_changed');

		const nameEntry = changeLog.find((entry) => entry.entryType === 'name_changed');
		expect(nameEntry?.text).toContain('New name');
		expect(nameEntry?.text).toContain('Fixture project');

		const coverEntry = changeLog.find((entry) => entry.entryType === 'cover_changed');
		expect(coverEntry?.text).toContain(assetId);
	});

	it('does not log a change-log entry when a field is left unchanged', async () => {
		const { t, projectId } = await seedProjectFixture([{ authUserId: 'alice' }]);
		const alice = t.withIdentity({ subject: 'alice' });

		await alice.mutation(api.projects.update, {
			projectId,
			name: 'Fixture project' // same as seeded name
		});

		const changeLog = await alice.query(api.projects.listChangeLog, { projectId });
		expect(changeLog.some((entry) => entry.entryType === 'name_changed')).toBe(false);
	});

	it('rejects a cover asset that is not owned by the caller', async () => {
		const { t, projectId } = await seedProjectFixture([{ authUserId: 'alice' }]);
		const alice = t.withIdentity({ subject: 'alice' });

		const assetId = await t.run(async (ctx) => {
			const now = Date.now();
			return await ctx.db.insert('mediaAssets', {
				ownerUserId: 'someone-else',
				mediaKind: 'image',
				status: 'ready',
				acceptedContentTypes: ['image/jpeg'],
				maxBytes: 10_000_000,
				enableCompression: true,
				enableSafetyScreening: true,
				storageProvider: 's3',
				sourceObjectRevision: 1,
				pipelineVersion: 1,
				attemptCount: 1,
				stepResults: [],
				createdAt: now,
				updatedAt: now
			});
		});

		await expect(
			alice.mutation(api.projects.update, { projectId, coverImageMediaAssetId: assetId })
		).rejects.toThrow('Cover image not found');
	});

	it('rejects a cover asset that is not yet ready', async () => {
		const { t, projectId } = await seedProjectFixture([{ authUserId: 'alice' }]);
		const alice = t.withIdentity({ subject: 'alice' });

		const assetId = await t.run(async (ctx) => {
			const now = Date.now();
			return await ctx.db.insert('mediaAssets', {
				ownerUserId: 'alice',
				mediaKind: 'image',
				status: 'processing',
				acceptedContentTypes: ['image/jpeg'],
				maxBytes: 10_000_000,
				enableCompression: true,
				enableSafetyScreening: true,
				storageProvider: 's3',
				sourceObjectRevision: 1,
				pipelineVersion: 1,
				attemptCount: 1,
				stepResults: [],
				createdAt: now,
				updatedAt: now
			});
		});

		await expect(
			alice.mutation(api.projects.update, { projectId, coverImageMediaAssetId: assetId })
		).rejects.toThrow('Cover image is not ready');
	});
});
