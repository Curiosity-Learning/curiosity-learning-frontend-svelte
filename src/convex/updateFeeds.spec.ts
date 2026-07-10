import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

/**
 * Minimal building blocks for feed tests: a club-read role, a profile, and helpers to attach
 * club membership / project attribution / posted updates. Kept intentionally lower-level than
 * `updates.spec.ts`'s `seedFixture` (which is project-member-centric) since these tests are about
 * the feed's club-attribution and visibility filtering, not project-membership guards.
 */
const seedBase = async () => {
	const t = convexTest(schema, modules);
	const now = Date.now();

	const { readRoleId } = await t.run(async (ctx) => {
		const readRoleId = await ctx.db.insert('clubRoles', {
			key: 'learner',
			name: 'Learner',
			permissions: ['project:read'],
			order: 0,
			createdAt: now
		});
		return { readRoleId };
	});

	return { t, readRoleId, now };
};

const insertProfile = async (
	t: ReturnType<typeof convexTest>,
	authUserId: string
): Promise<Id<'profiles'>> =>
	t.run(async (ctx) => {
		return await ctx.db.insert('profiles', {
			authUserId,
			username: authUserId,
			isVerified: true,
			firstLoginCompleted: true,
			updatedAt: Date.now()
		});
	});

const insertClub = async (
	t: ReturnType<typeof convexTest>,
	ownerProfileId: Id<'profiles'>,
	name = 'Fixture club'
): Promise<Id<'clubs'>> =>
	t.run(async (ctx) => {
		const now = Date.now();
		return await ctx.db.insert('clubs', {
			name,
			discoverable: false,
			createdByProfileId: ownerProfileId,
			createdAt: now,
			updatedAt: now
		});
	});

const joinClub = async (
	t: ReturnType<typeof convexTest>,
	clubId: Id<'clubs'>,
	profileId: Id<'profiles'>,
	roleId: Id<'clubRoles'>
) =>
	t.run(async (ctx) => {
		await ctx.db.insert('clubMembers', {
			clubId,
			profileId,
			roleId,
			createdAt: Date.now()
		});
	});

const insertProject = async (
	t: ReturnType<typeof convexTest>,
	options: {
		creatorProfileId: Id<'profiles'>;
		visibility: 'clubs' | 'global';
		name?: string;
	}
): Promise<Id<'projects'>> =>
	t.run(async (ctx) => {
		const now = Date.now();
		return await ctx.db.insert('projects', {
			name: options.name ?? 'Fixture project',
			dueDate: now + 7 * 24 * 60 * 60 * 1000,
			visibility: options.visibility,
			createdByProfileId: options.creatorProfileId,
			createdAt: now,
			updatedAt: now
		});
	});

const attributeProject = async (
	t: ReturnType<typeof convexTest>,
	projectId: Id<'projects'>,
	profileId: Id<'profiles'>,
	clubId: Id<'clubs'>
) =>
	t.run(async (ctx) => {
		await ctx.db.insert('projectAttributions', {
			projectId,
			profileId,
			clubId,
			createdAt: Date.now()
		});
	});

/** Posts an update directly (bypassing `updates.create`'s membership guards) and denormalizes
 * the `updateClubs` rows the same way `updates.create` does, so feed-listing tests don't need a
 * full project-membership fixture just to get an update onto the board. */
const insertUpdate = async (
	t: ReturnType<typeof convexTest>,
	options: {
		projectId: Id<'projects'>;
		authorProfileId: Id<'profiles'>;
		content: string;
		createdAt: number;
		attributedClubIds?: Id<'clubs'>[];
	}
): Promise<Id<'updates'>> =>
	t.run(async (ctx) => {
		const updateId = await ctx.db.insert('updates', {
			projectId: options.projectId,
			content: options.content,
			createdByProfileId: options.authorProfileId,
			createdAt: options.createdAt,
			updatedAt: options.createdAt
		});
		for (const clubId of options.attributedClubIds ?? []) {
			await ctx.db.insert('updateClubs', {
				updateId,
				clubId,
				projectId: options.projectId,
				createdAt: options.createdAt
			});
		}
		return updateId;
	});

describe('updates.listForViewer (My Clubs feed)', () => {
	it('returns updates from projects attributed to ANY club the viewer belongs to', async () => {
		const { t, readRoleId } = await seedBase();
		const viewerProfileId = await insertProfile(t, 'viewer');
		const otherProfileId = await insertProfile(t, 'other');

		const clubA = await insertClub(t, otherProfileId, 'Club A');
		const clubB = await insertClub(t, otherProfileId, 'Club B (viewer not in this one)');
		await joinClub(t, clubA, viewerProfileId, readRoleId);

		const projectAttributedToA = await insertProject(t, {
			creatorProfileId: otherProfileId,
			visibility: 'clubs',
			name: 'Project in A'
		});
		await attributeProject(t, projectAttributedToA, otherProfileId, clubA);
		await insertUpdate(t, {
			projectId: projectAttributedToA,
			authorProfileId: otherProfileId,
			content: 'Update in club A',
			createdAt: Date.now(),
			attributedClubIds: [clubA]
		});

		const projectAttributedToB = await insertProject(t, {
			creatorProfileId: otherProfileId,
			visibility: 'clubs',
			name: 'Project in B'
		});
		await attributeProject(t, projectAttributedToB, otherProfileId, clubB);
		await insertUpdate(t, {
			projectId: projectAttributedToB,
			authorProfileId: otherProfileId,
			content: 'Update in club B',
			createdAt: Date.now(),
			attributedClubIds: [clubB]
		});

		const page = await t
			.withIdentity({ subject: 'viewer' })
			.query(api.updates.listForViewer, { limit: 20 });

		expect(page.items).toHaveLength(1);
		expect(page.items[0]?.content).toBe('Update in club A');
	});

	it('is not filtered by any "active club" concept — surfaces updates across all the viewer’s clubs', async () => {
		const { t, readRoleId } = await seedBase();
		const viewerProfileId = await insertProfile(t, 'viewer');
		const otherProfileId = await insertProfile(t, 'other');

		const clubA = await insertClub(t, otherProfileId, 'Club A');
		const clubB = await insertClub(t, otherProfileId, 'Club B');
		await joinClub(t, clubA, viewerProfileId, readRoleId);
		await joinClub(t, clubB, viewerProfileId, readRoleId);

		const projectA = await insertProject(t, { creatorProfileId: otherProfileId, visibility: 'clubs' });
		await attributeProject(t, projectA, otherProfileId, clubA);
		await insertUpdate(t, {
			projectId: projectA,
			authorProfileId: otherProfileId,
			content: 'From club A',
			createdAt: Date.now(),
			attributedClubIds: [clubA]
		});

		const projectB = await insertProject(t, { creatorProfileId: otherProfileId, visibility: 'clubs' });
		await attributeProject(t, projectB, otherProfileId, clubB);
		await insertUpdate(t, {
			projectId: projectB,
			authorProfileId: otherProfileId,
			content: 'From club B',
			createdAt: Date.now(),
			attributedClubIds: [clubB]
		});

		const page = await t
			.withIdentity({ subject: 'viewer' })
			.query(api.updates.listForViewer, { limit: 20 });

		expect(page.items.map((item) => item.content).sort()).toEqual(['From club A', 'From club B']);
	});

	it('returns an empty page for a user with zero club memberships', async () => {
		const { t } = await seedBase();
		await insertProfile(t, 'viewer');

		const page = await t
			.withIdentity({ subject: 'viewer' })
			.query(api.updates.listForViewer, { limit: 20 });

		expect(page.items).toEqual([]);
		expect(page.nextCursor).toBeNull();
	});

	it('paginates via cursor rather than returning everything unbounded', async () => {
		const { t, readRoleId } = await seedBase();
		const viewerProfileId = await insertProfile(t, 'viewer');
		const otherProfileId = await insertProfile(t, 'other');
		const club = await insertClub(t, otherProfileId);
		await joinClub(t, club, viewerProfileId, readRoleId);

		const project = await insertProject(t, { creatorProfileId: otherProfileId, visibility: 'clubs' });
		await attributeProject(t, project, otherProfileId, club);

		const baseTime = Date.now();
		for (let i = 0; i < 5; i += 1) {
			await insertUpdate(t, {
				projectId: project,
				authorProfileId: otherProfileId,
				content: `Update ${i}`,
				createdAt: baseTime + i,
				attributedClubIds: [club]
			});
		}

		const firstPage = await t
			.withIdentity({ subject: 'viewer' })
			.query(api.updates.listForViewer, { limit: 2 });

		expect(firstPage.items).toHaveLength(2);
		// Newest first.
		expect(firstPage.items[0]?.content).toBe('Update 4');
		expect(firstPage.items[1]?.content).toBe('Update 3');
		expect(firstPage.nextCursor).not.toBeNull();

		const secondPage = await t
			.withIdentity({ subject: 'viewer' })
			.query(api.updates.listForViewer, { limit: 2, cursor: firstPage.nextCursor! });

		expect(secondPage.items.map((item) => item.content)).toEqual(['Update 2', 'Update 1']);

		const thirdPage = await t
			.withIdentity({ subject: 'viewer' })
			.query(api.updates.listForViewer, { limit: 2, cursor: secondPage.nextCursor! });

		expect(thirdPage.items.map((item) => item.content)).toEqual(['Update 0']);
		expect(thirdPage.nextCursor).toBeNull();
	});
});

describe('updates.listGlobal (All feed)', () => {
	it('only surfaces updates from projects with global visibility', async () => {
		const { t } = await seedBase();
		const viewerProfileId = await insertProfile(t, 'viewer');
		const authorProfileId = await insertProfile(t, 'author');

		const globalProject = await insertProject(t, {
			creatorProfileId: authorProfileId,
			visibility: 'global',
			name: 'Global project'
		});
		await insertUpdate(t, {
			projectId: globalProject,
			authorProfileId,
			content: 'Global update',
			createdAt: Date.now()
		});

		const clubsOnlyProject = await insertProject(t, {
			creatorProfileId: authorProfileId,
			visibility: 'clubs',
			name: 'Clubs-only project'
		});
		await insertUpdate(t, {
			projectId: clubsOnlyProject,
			authorProfileId,
			content: 'Clubs-only update',
			createdAt: Date.now()
		});

		void viewerProfileId;
		const page = await t
			.withIdentity({ subject: 'viewer' })
			.query(api.updates.listGlobal, { limit: 20 });

		expect(page.items).toHaveLength(1);
		expect(page.items[0]?.content).toBe('Global update');
	});

	it('is visible to a viewer who is not a member of any club attributed to the project', async () => {
		const { t } = await seedBase();
		await insertProfile(t, 'viewer');
		const authorProfileId = await insertProfile(t, 'author');

		const globalProject = await insertProject(t, {
			creatorProfileId: authorProfileId,
			visibility: 'global'
		});
		await insertUpdate(t, {
			projectId: globalProject,
			authorProfileId,
			content: 'Anyone can see this',
			createdAt: Date.now()
		});

		const page = await t
			.withIdentity({ subject: 'viewer' })
			.query(api.updates.listGlobal, { limit: 20 });

		expect(page.items).toHaveLength(1);
	});

	it('paginates via cursor', async () => {
		const { t } = await seedBase();
		await insertProfile(t, 'viewer');
		const authorProfileId = await insertProfile(t, 'author');
		const project = await insertProject(t, { creatorProfileId: authorProfileId, visibility: 'global' });

		const baseTime = Date.now();
		for (let i = 0; i < 3; i += 1) {
			await insertUpdate(t, {
				projectId: project,
				authorProfileId,
				content: `Global update ${i}`,
				createdAt: baseTime + i
			});
		}

		const firstPage = await t
			.withIdentity({ subject: 'viewer' })
			.query(api.updates.listGlobal, { limit: 2 });
		expect(firstPage.items.map((item) => item.content)).toEqual([
			'Global update 2',
			'Global update 1'
		]);
		expect(firstPage.nextCursor).not.toBeNull();

		const secondPage = await t
			.withIdentity({ subject: 'viewer' })
			.query(api.updates.listGlobal, { limit: 2, cursor: firstPage.nextCursor! });
		expect(secondPage.items.map((item) => item.content)).toEqual(['Global update 0']);
		expect(secondPage.nextCursor).toBeNull();
	});
});
