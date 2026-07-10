import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

/**
 * Building blocks for `profiles.getById` tests, mirroring `updateFeeds.spec.ts`'s
 * lower-level fixture style (rather than `updates.spec.ts`'s single-project `seedFixture`)
 * since these tests need independent control over clubs, club kind, project visibility,
 * and per-member project lifecycle state (active/done/left).
 */
const seedBase = async () => {
	const t = convexTest(schema, modules);
	const now = Date.now();

	const { learnerRoleId, guideRoleId, contributorRoleId } = await t.run(async (ctx) => {
		const learnerRoleId = await ctx.db.insert('clubRoles', {
			key: 'learner',
			name: 'Learner',
			permissions: ['project:read'],
			order: 0,
			createdAt: now
		});
		const guideRoleId = await ctx.db.insert('clubRoles', {
			key: 'guide',
			name: 'Guide',
			permissions: ['project:read', 'project:update', 'project:create'],
			order: 1,
			createdAt: now
		});
		const contributorRoleId = await ctx.db.insert('projectRoles', {
			key: 'contributor',
			name: 'Contributor',
			permissions: ['project:read', 'project:update'],
			order: 0,
			createdAt: now
		});
		return { learnerRoleId, guideRoleId, contributorRoleId };
	});

	return { t, learnerRoleId, guideRoleId, contributorRoleId };
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
	options?: { name?: string; kind?: 'curiosity' | 'coc' }
): Promise<Id<'clubs'>> =>
	t.run(async (ctx) => {
		const now = Date.now();
		return await ctx.db.insert('clubs', {
			name: options?.name ?? 'Fixture club',
			kind: options?.kind ?? 'curiosity',
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
	roleId: Id<'clubRoles'>,
	options?: { leftAt?: number }
) =>
	t.run(async (ctx) => {
		await ctx.db.insert('clubMembers', {
			clubId,
			profileId,
			roleId,
			leftAt: options?.leftAt,
			createdAt: Date.now()
		});
	});

const insertProject = async (
	t: ReturnType<typeof convexTest>,
	options: {
		creatorProfileId: Id<'profiles'>;
		visibility: 'clubs' | 'global';
		name?: string;
		archivedAt?: number;
	}
): Promise<Id<'projects'>> =>
	t.run(async (ctx) => {
		const now = Date.now();
		return await ctx.db.insert('projects', {
			name: options.name ?? 'Fixture project',
			dueDate: now + 7 * 24 * 60 * 60 * 1000,
			visibility: options.visibility,
			archivedAt: options.archivedAt,
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

const addProjectMember = async (
	t: ReturnType<typeof convexTest>,
	projectId: Id<'projects'>,
	profileId: Id<'profiles'>,
	roleId: Id<'projectRoles'>,
	options?: { doneDate?: number; leftAt?: number }
) =>
	t.run(async (ctx) => {
		await ctx.db.insert('projectMembers', {
			projectId,
			profileId,
			roleId,
			doneDate: options?.doneDate,
			leftAt: options?.leftAt,
			createdAt: Date.now()
		});
	});

const insertUpdate = async (
	t: ReturnType<typeof convexTest>,
	options: {
		projectId: Id<'projects'>;
		authorProfileId: Id<'profiles'>;
		content: string;
		createdAt: number;
	}
) =>
	t.run(async (ctx) => {
		return await ctx.db.insert('updates', {
			projectId: options.projectId,
			content: options.content,
			createdByProfileId: options.authorProfileId,
			createdAt: options.createdAt,
			updatedAt: options.createdAt
		});
	});

describe('profiles.getById', () => {
	it('shows a global project to a stranger with no shared club', async () => {
		const { t, contributorRoleId } = await seedBase();
		const ownerProfileId = await insertProfile(t, 'owner');
		const strangerProfileId = await insertProfile(t, 'stranger');
		void strangerProfileId;

		const projectId = await insertProject(t, {
			creatorProfileId: ownerProfileId,
			visibility: 'global',
			name: 'Global project'
		});
		await addProjectMember(t, projectId, ownerProfileId, contributorRoleId);

		const result = await t
			.withIdentity({ subject: 'stranger' })
			.query(api.profiles.getById, { profileId: ownerProfileId });

		expect(result.projects.current).toHaveLength(1);
		expect(result.projects.current[0]?.name).toBe('Global project');
		expect(result.projects.current[0]?.sharedClub).toBe(false);
	});

	it('hides a clubs-only project from a stranger', async () => {
		const { t, learnerRoleId, contributorRoleId } = await seedBase();
		const ownerProfileId = await insertProfile(t, 'owner');
		await insertProfile(t, 'stranger');

		const clubId = await insertClub(t, ownerProfileId);
		await joinClub(t, clubId, ownerProfileId, learnerRoleId);

		const projectId = await insertProject(t, {
			creatorProfileId: ownerProfileId,
			visibility: 'clubs',
			name: 'Clubs-only project'
		});
		await attributeProject(t, projectId, ownerProfileId, clubId);
		await addProjectMember(t, projectId, ownerProfileId, contributorRoleId);

		const result = await t
			.withIdentity({ subject: 'stranger' })
			.query(api.profiles.getById, { profileId: ownerProfileId });

		expect(result.projects.current).toHaveLength(0);
		expect(result.projects.showcase).toHaveLength(0);
	});

	it('shows a clubs-only project to a clubmate with the sharedClub flag set', async () => {
		const { t, learnerRoleId, contributorRoleId } = await seedBase();
		const ownerProfileId = await insertProfile(t, 'owner');
		const clubmateProfileId = await insertProfile(t, 'clubmate');

		const clubId = await insertClub(t, ownerProfileId);
		await joinClub(t, clubId, ownerProfileId, learnerRoleId);
		await joinClub(t, clubId, clubmateProfileId, learnerRoleId);

		const projectId = await insertProject(t, {
			creatorProfileId: ownerProfileId,
			visibility: 'clubs',
			name: 'Clubs-only project'
		});
		await attributeProject(t, projectId, ownerProfileId, clubId);
		await addProjectMember(t, projectId, ownerProfileId, contributorRoleId);

		const result = await t
			.withIdentity({ subject: 'clubmate' })
			.query(api.profiles.getById, { profileId: ownerProfileId });

		expect(result.projects.current).toHaveLength(1);
		expect(result.projects.current[0]?.name).toBe('Clubs-only project');
		expect(result.projects.current[0]?.sharedClub).toBe(true);
	});

	it('filters updates the same way as projects: hidden from a stranger, visible with sharedClub to a clubmate', async () => {
		const { t, learnerRoleId, contributorRoleId } = await seedBase();
		const ownerProfileId = await insertProfile(t, 'owner');
		const clubmateProfileId = await insertProfile(t, 'clubmate');
		await insertProfile(t, 'stranger');

		const clubId = await insertClub(t, ownerProfileId);
		await joinClub(t, clubId, ownerProfileId, learnerRoleId);
		await joinClub(t, clubId, clubmateProfileId, learnerRoleId);

		const projectId = await insertProject(t, {
			creatorProfileId: ownerProfileId,
			visibility: 'clubs',
			name: 'Clubs-only project'
		});
		await attributeProject(t, projectId, ownerProfileId, clubId);
		await addProjectMember(t, projectId, ownerProfileId, contributorRoleId);
		await insertUpdate(t, {
			projectId,
			authorProfileId: ownerProfileId,
			content: 'Progress update',
			createdAt: Date.now()
		});

		const strangerResult = await t
			.withIdentity({ subject: 'stranger' })
			.query(api.profiles.getById, { profileId: ownerProfileId });
		expect(strangerResult.updates).toHaveLength(0);

		const clubmateResult = await t
			.withIdentity({ subject: 'clubmate' })
			.query(api.profiles.getById, { profileId: ownerProfileId });
		expect(clubmateResult.updates).toHaveLength(1);
		expect(clubmateResult.updates[0]?.content).toBe('Progress update');
		expect(clubmateResult.updates[0]?.sharedClub).toBe(true);
	});

	it('excludes left club memberships and CoC groups from the active-clubs list', async () => {
		const { t, learnerRoleId } = await seedBase();
		const ownerProfileId = await insertProfile(t, 'owner');
		const viewerProfileId = await insertProfile(t, 'viewer');
		void viewerProfileId;

		const activeClubId = await insertClub(t, ownerProfileId, { name: 'Active club' });
		await joinClub(t, activeClubId, ownerProfileId, learnerRoleId);

		const leftClubId = await insertClub(t, ownerProfileId, { name: 'Left club' });
		await joinClub(t, leftClubId, ownerProfileId, learnerRoleId, { leftAt: Date.now() });

		const cocClubId = await insertClub(t, ownerProfileId, { name: 'CoC group', kind: 'coc' });
		await joinClub(t, cocClubId, ownerProfileId, learnerRoleId);

		const result = await t
			.withIdentity({ subject: 'viewer' })
			.query(api.profiles.getById, { profileId: ownerProfileId });

		expect(result.clubs).toHaveLength(1);
		expect(result.clubs[0]?.clubName).toBe('Active club');
	});

	it('splits projects into current vs showcase: archived or done/left membership is showcase', async () => {
		const { t, learnerRoleId, contributorRoleId } = await seedBase();
		const ownerProfileId = await insertProfile(t, 'owner');
		await insertProfile(t, 'viewer');

		const clubId = await insertClub(t, ownerProfileId);
		await joinClub(t, clubId, ownerProfileId, learnerRoleId);

		const currentProjectId = await insertProject(t, {
			creatorProfileId: ownerProfileId,
			visibility: 'global',
			name: 'Current project'
		});
		await addProjectMember(t, currentProjectId, ownerProfileId, contributorRoleId);

		const archivedProjectId = await insertProject(t, {
			creatorProfileId: ownerProfileId,
			visibility: 'global',
			name: 'Archived project',
			archivedAt: Date.now()
		});
		await addProjectMember(t, archivedProjectId, ownerProfileId, contributorRoleId, {
			doneDate: Date.now()
		});

		const doneProjectId = await insertProject(t, {
			creatorProfileId: ownerProfileId,
			visibility: 'global',
			name: 'Project I am done with'
		});
		await addProjectMember(t, doneProjectId, ownerProfileId, contributorRoleId, {
			doneDate: Date.now()
		});

		const result = await t
			.withIdentity({ subject: 'viewer' })
			.query(api.profiles.getById, { profileId: ownerProfileId });

		const currentNames = result.projects.current.map((project) => project.name).sort();
		const showcaseNames = result.projects.showcase.map((project) => project.name).sort();

		expect(currentNames).toEqual(['Current project']);
		expect(showcaseNames).toEqual(['Archived project', 'Project I am done with']);
	});

	it('marks isSelf and never sets sharedClub when viewing your own profile', async () => {
		const { t, learnerRoleId, contributorRoleId } = await seedBase();
		const ownerProfileId = await insertProfile(t, 'owner');

		const clubId = await insertClub(t, ownerProfileId);
		await joinClub(t, clubId, ownerProfileId, learnerRoleId);

		const projectId = await insertProject(t, {
			creatorProfileId: ownerProfileId,
			visibility: 'clubs',
			name: 'My clubs-only project'
		});
		await attributeProject(t, projectId, ownerProfileId, clubId);
		await addProjectMember(t, projectId, ownerProfileId, contributorRoleId);

		const result = await t
			.withIdentity({ subject: 'owner' })
			.query(api.profiles.getById, { profileId: ownerProfileId });

		expect(result.isSelf).toBe(true);
		expect(result.projects.current).toHaveLength(1);
		expect(result.projects.current[0]?.sharedClub).toBe(false);
	});
});
