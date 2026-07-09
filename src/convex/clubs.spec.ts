import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

const seedClubPermissionFixture = async () => {
	const t = convexTest(schema, modules);
	const ids = await t.run(async (ctx) => {
		const now = Date.now();
		const guideRoleId = await ctx.db.insert('clubRoles', {
			key: 'guide',
			name: 'Guide',
			permissions: ['club:read', 'club:edit'],
			order: 0,
			createdAt: now
		});
		const learnerRoleId = await ctx.db.insert('clubRoles', {
			key: 'learner',
			name: 'Learner',
			permissions: ['club:read'],
			order: 1,
			createdAt: now
		});
		const guideProfileId = await ctx.db.insert('profiles', {
			authUserId: 'guide-user',
			isVerified: true,
			firstLoginCompleted: true,
			updatedAt: now
		});
		const learnerProfileId = await ctx.db.insert('profiles', {
			authUserId: 'learner-user',
			isVerified: true,
			firstLoginCompleted: true,
			updatedAt: now
		});
		const clubId = await ctx.db.insert('clubs', {
			name: 'Curiosity Club',
			description: 'Original description',
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
		await ctx.db.insert('clubMembers', {
			clubId,
			profileId: learnerProfileId,
			roleId: learnerRoleId,
			createdAt: now
		});
		return { clubId };
	});

	return { t, ...ids };
};

describe('club settings permissions', () => {
	it('allows a member with club:edit to update and clear settings', async () => {
		const { t, clubId } = await seedClubPermissionFixture();

		await t.withIdentity({ subject: 'guide-user' }).mutation(api.clubs.updateClub, {
			clubId,
			name: ' Updated Club ',
			description: null
		});

		const club = await t.run((ctx) => ctx.db.get(clubId));
		expect(club?.name).toBe('Updated Club');
		expect(club?.description).toBeUndefined();
	});

	it('rejects a member without club:edit', async () => {
		const { t, clubId } = await seedClubPermissionFixture();

		await expect(
			t.withIdentity({ subject: 'learner-user' }).mutation(api.clubs.updateClub, {
				clubId,
				name: 'Unauthorized update'
			})
		).rejects.toThrow('Permission denied');

		const club = await t.run((ctx) => ctx.db.get(clubId));
		expect(club?.name).toBe('Curiosity Club');
	});
});

describe('resetClubCode', () => {
	it('allows a guide to reset the invite code, invalidating the old one', async () => {
		const { t, clubId } = await seedClubPermissionFixture();

		await t.run(async (ctx) => {
			await ctx.db.patch(clubId, { clubCode: 'AAAAAA' });
		});

		const result = await t
			.withIdentity({ subject: 'guide-user' })
			.mutation(api.clubs.resetClubCode, { clubId });

		expect(result.code).not.toBe('AAAAAA');
		expect(result.code).toMatch(/^[A-Z0-9]{6}$/);

		const club = await t.run((ctx) => ctx.db.get(clubId));
		expect(club?.clubCode).toBe(result.code);
	});

	it('rejects a learner resetting the invite code', async () => {
		const { t, clubId } = await seedClubPermissionFixture();

		await expect(
			t.withIdentity({ subject: 'learner-user' }).mutation(api.clubs.resetClubCode, { clubId })
		).rejects.toThrow('Permission denied');
	});
});

describe('active club switching', () => {
	it('allows an active club member to switch', async () => {
		const { t, clubId } = await seedClubPermissionFixture();

		await t.withIdentity({ subject: 'learner-user' }).mutation(api.clubs.switchActiveClub, {
			clubId
		});

		const profile = await t.run((ctx) =>
			ctx.db
				.query('profiles')
				.withIndex('by_auth_user_id', (q) => q.eq('authUserId', 'learner-user'))
				.first()
		);
		expect(profile?.activeClubId).toBe(clubId);
	});

	it('rejects switching to a club without active membership', async () => {
		const { t, clubId } = await seedClubPermissionFixture();

		await expect(
			t.withIdentity({ subject: 'outsider-user' }).mutation(api.clubs.switchActiveClub, {
				clubId
			})
		).rejects.toThrow('You are not a member of this club');
	});
});
