import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

const seedBase = async () => {
	const t = convexTest(schema, modules);
	const now = Date.now();
	const readRoleId = await t.run(async (ctx) =>
		ctx.db.insert('clubRoles', {
			key: 'learner',
			name: 'Learner',
			permissions: ['project:read'],
			order: 0,
			createdAt: now
		})
	);
	return { t, readRoleId };
};

const insertProfile = async (t: ReturnType<typeof convexTest>, authUserId: string): Promise<Id<'profiles'>> =>
	t.run(async (ctx) =>
		ctx.db.insert('profiles', {
			authUserId,
			username: authUserId,
			isVerified: true,
			firstLoginCompleted: true,
			updatedAt: Date.now()
		})
	);

const insertClub = async (t: ReturnType<typeof convexTest>, ownerProfileId: Id<'profiles'>): Promise<Id<'clubs'>> =>
	t.run(async (ctx) => {
		const now = Date.now();
		return ctx.db.insert('clubs', {
			name: 'Fixture club',
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
	leftAt?: number
) =>
	t.run(async (ctx) => {
		await ctx.db.insert('clubMembers', {
			clubId,
			profileId,
			roleId,
			leftAt,
			createdAt: Date.now()
		});
	});

const insertProject = async (
	t: ReturnType<typeof convexTest>,
	options: { creatorProfileId: Id<'profiles'>; visibility: 'clubs' | 'global' }
): Promise<Id<'projects'>> =>
	t.run(async (ctx) => {
		const now = Date.now();
		return ctx.db.insert('projects', {
			name: 'Fixture project',
			dueDate: now + 7 * 24 * 60 * 60 * 1000,
			visibility: options.visibility,
			createdByProfileId: options.creatorProfileId,
			createdAt: now,
			updatedAt: now
		});
	});

const insertProjectMember = async (
	t: ReturnType<typeof convexTest>,
	projectId: Id<'projects'>,
	profileId: Id<'profiles'>
) =>
	t.run(async (ctx) => {
		const now = Date.now();
		const roleId = await ctx.db.insert('projectRoles', {
			key: 'contributor',
			name: 'Contributor',
			permissions: ['project:read', 'project:update'],
			order: 0,
			createdAt: now
		});
		await ctx.db.insert('projectMembers', {
			projectId,
			profileId,
			roleId,
			createdAt: now
		});
	});

const setProjectVisibility = async (
	t: ReturnType<typeof convexTest>,
	projectId: Id<'projects'>,
	visibility: 'clubs' | 'global'
) =>
	t.run(async (ctx) => {
		await ctx.db.patch(projectId, { visibility, updatedAt: Date.now() });
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

const insertUpdate = async (
	t: ReturnType<typeof convexTest>,
	options: { projectId: Id<'projects'>; authorProfileId: Id<'profiles'> }
): Promise<Id<'updates'>> =>
	t.run(async (ctx) => {
		const now = Date.now();
		return ctx.db.insert('updates', {
			projectId: options.projectId,
			content: 'An update',
			createdByProfileId: options.authorProfileId,
			createdAt: now,
			updatedAt: now
		});
	});

describe('updateComments.addComment', () => {
	it('rejects a user with zero club memberships', async () => {
		const { t } = await seedBase();
		const authorProfileId = await insertProfile(t, 'author');
		const commenterProfileId = await insertProfile(t, 'commenter');
		void commenterProfileId;

		const project = await insertProject(t, { creatorProfileId: authorProfileId, visibility: 'global' });
		const updateId = await insertUpdate(t, { projectId: project, authorProfileId });

		await expect(
			t
				.withIdentity({ subject: 'commenter' })
				.mutation(api.updateComments.addComment, { updateId, content: 'Nice work!' })
		).rejects.toThrow('You need to be an active member of a club to comment.');
	});

	it('allows a club member to comment on a global-visibility project they are not attributed to', async () => {
		const { t, readRoleId } = await seedBase();
		const authorProfileId = await insertProfile(t, 'author');
		const commenterProfileId = await insertProfile(t, 'commenter');
		const commenterClub = await insertClub(t, commenterProfileId);
		await joinClub(t, commenterClub, commenterProfileId, readRoleId);

		const project = await insertProject(t, { creatorProfileId: authorProfileId, visibility: 'global' });
		const updateId = await insertUpdate(t, { projectId: project, authorProfileId });

		const comment = await t
			.withIdentity({ subject: 'commenter' })
			.mutation(api.updateComments.addComment, { updateId, content: 'Great progress!' });

		expect(comment?.content).toBe('Great progress!');
	});

	it('blocks a new outside comment after the project flips from global to clubs-only, while the old comment persists', async () => {
		const { t, readRoleId } = await seedBase();
		const authorProfileId = await insertProfile(t, 'author');
		const commenterProfileId = await insertProfile(t, 'commenter');
		const commenterClub = await insertClub(t, commenterProfileId);
		await joinClub(t, commenterClub, commenterProfileId, readRoleId);

		const project = await insertProject(t, { creatorProfileId: authorProfileId, visibility: 'global' });
		// A real `projectMembers` row for the author, so they retain view access once visibility
		// flips to 'clubs' (canViewProject's "project's own members" carve-out) — otherwise nobody
		// could observe that the old comment persisted.
		await insertProjectMember(t, project, authorProfileId);
		const updateId = await insertUpdate(t, { projectId: project, authorProfileId });

		const firstComment = await t
			.withIdentity({ subject: 'commenter' })
			.mutation(api.updateComments.addComment, { updateId, content: 'Commenting while global.' });
		expect(firstComment?.content).toBe('Commenting while global.');

		// Project flips to clubs-only and the commenter is not attributed to any club on it.
		await setProjectVisibility(t, project, 'clubs');

		await expect(
			t.withIdentity({ subject: 'commenter' }).mutation(api.updateComments.addComment, {
				updateId,
				content: 'Trying to comment again after the flip.'
			})
		).rejects.toThrow('Permission denied');

		// The old comment is still there and still visible to anyone who can see the update — in
		// this case the author, who remains a project member.
		const commentsForAuthor = await t
			.withIdentity({ subject: 'author' })
			.query(api.updateComments.listComments, { updateId });
		expect(commentsForAuthor.map((c) => c.content)).toEqual(['Commenting while global.']);
	});

	it('allows a club member attributed to the (now clubs-only) project to keep commenting', async () => {
		const { t, readRoleId } = await seedBase();
		const authorProfileId = await insertProfile(t, 'author');
		const memberProfileId = await insertProfile(t, 'member');
		const club = await insertClub(t, authorProfileId);
		await joinClub(t, club, memberProfileId, readRoleId);

		const project = await insertProject(t, { creatorProfileId: authorProfileId, visibility: 'clubs' });
		await attributeProject(t, project, authorProfileId, club);
		const updateId = await insertUpdate(t, { projectId: project, authorProfileId });

		const comment = await t
			.withIdentity({ subject: 'member' })
			.mutation(api.updateComments.addComment, { updateId, content: 'From an attributed club member.' });

		expect(comment?.content).toBe('From an attributed club member.');
	});

	it('rejects content over 1000 characters', async () => {
		const { t, readRoleId } = await seedBase();
		const authorProfileId = await insertProfile(t, 'author');
		const commenterProfileId = await insertProfile(t, 'commenter');
		const club = await insertClub(t, commenterProfileId);
		await joinClub(t, club, commenterProfileId, readRoleId);

		const project = await insertProject(t, { creatorProfileId: authorProfileId, visibility: 'global' });
		const updateId = await insertUpdate(t, { projectId: project, authorProfileId });

		await expect(
			t.withIdentity({ subject: 'commenter' }).mutation(api.updateComments.addComment, {
				updateId,
				content: 'a'.repeat(1001)
			})
		).rejects.toThrow('Comments must be 1000 characters or fewer.');
	});

	it('allows exactly 1000 characters and trims whitespace', async () => {
		const { t, readRoleId } = await seedBase();
		const authorProfileId = await insertProfile(t, 'author');
		const commenterProfileId = await insertProfile(t, 'commenter');
		const club = await insertClub(t, commenterProfileId);
		await joinClub(t, club, commenterProfileId, readRoleId);

		const project = await insertProject(t, { creatorProfileId: authorProfileId, visibility: 'global' });
		const updateId = await insertUpdate(t, { projectId: project, authorProfileId });

		const maxComment = await t
			.withIdentity({ subject: 'commenter' })
			.mutation(api.updateComments.addComment, { updateId, content: 'a'.repeat(1000) });
		expect(maxComment?.content).toHaveLength(1000);

		const trimmedComment = await t
			.withIdentity({ subject: 'commenter' })
			.mutation(api.updateComments.addComment, { updateId, content: '  padded  ' });
		expect(trimmedComment?.content).toBe('padded');
	});

	it('rejects empty (or whitespace-only) content', async () => {
		const { t, readRoleId } = await seedBase();
		const authorProfileId = await insertProfile(t, 'author');
		const commenterProfileId = await insertProfile(t, 'commenter');
		const club = await insertClub(t, commenterProfileId);
		await joinClub(t, club, commenterProfileId, readRoleId);

		const project = await insertProject(t, { creatorProfileId: authorProfileId, visibility: 'global' });
		const updateId = await insertUpdate(t, { projectId: project, authorProfileId });

		await expect(
			t
				.withIdentity({ subject: 'commenter' })
				.mutation(api.updateComments.addComment, { updateId, content: '   ' })
		).rejects.toThrow('Comment text is required.');
	});

	it('rejects a commenter who left their only club', async () => {
		const { t, readRoleId } = await seedBase();
		const authorProfileId = await insertProfile(t, 'author');
		const commenterProfileId = await insertProfile(t, 'commenter');
		const club = await insertClub(t, commenterProfileId);
		await joinClub(t, club, commenterProfileId, readRoleId, Date.now());

		const project = await insertProject(t, { creatorProfileId: authorProfileId, visibility: 'global' });
		const updateId = await insertUpdate(t, { projectId: project, authorProfileId });

		await expect(
			t
				.withIdentity({ subject: 'commenter' })
				.mutation(api.updateComments.addComment, { updateId, content: 'Should be blocked.' })
		).rejects.toThrow('You need to be an active member of a club to comment.');
	});
});

describe('updateComments.canComment', () => {
	it('reflects eligibility without throwing', async () => {
		const { t } = await seedBase();
		const authorProfileId = await insertProfile(t, 'author');
		await insertProfile(t, 'commenter');
		const project = await insertProject(t, { creatorProfileId: authorProfileId, visibility: 'global' });
		const updateId = await insertUpdate(t, { projectId: project, authorProfileId });

		const eligible = await t
			.withIdentity({ subject: 'commenter' })
			.query(api.updateComments.canComment, { updateId });
		expect(eligible).toBe(false);
	});
});

describe('updateComments.listComments / countComments', () => {
	it('is gated the same way as viewing the update — a non-member cannot read comments on a clubs-only project', async () => {
		const { t, readRoleId } = await seedBase();
		const authorProfileId = await insertProfile(t, 'author');
		const outsiderProfileId = await insertProfile(t, 'outsider');
		void outsiderProfileId;
		const club = await insertClub(t, authorProfileId);
		await joinClub(t, club, authorProfileId, readRoleId);

		const project = await insertProject(t, { creatorProfileId: authorProfileId, visibility: 'clubs' });
		await attributeProject(t, project, authorProfileId, club);
		const updateId = await insertUpdate(t, { projectId: project, authorProfileId });

		await expect(
			t.withIdentity({ subject: 'outsider' }).query(api.updateComments.listComments, { updateId })
		).rejects.toThrow('Permission denied');

		const count = await t
			.withIdentity({ subject: 'outsider' })
			.query(api.updateComments.countComments, { updateId });
		expect(count).toBe(0);
	});
});
