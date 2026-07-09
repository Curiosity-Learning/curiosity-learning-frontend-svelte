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

describe('discoverability', () => {
	it('createClub defaults new clubs to non-discoverable', async () => {
		const t = convexTest(schema, modules);
		await t.run(async (ctx) => {
			await ctx.db.insert('clubRoles', {
				key: 'guide',
				name: 'Guide',
				permissions: ['club:read', 'club:edit'],
				order: 0,
				createdAt: Date.now()
			});
			await ctx.db.insert('clubRoles', {
				key: 'learner',
				name: 'Learner',
				permissions: ['club:read'],
				order: 1,
				createdAt: Date.now()
			});
			// Pre-seed the profile so createClub's getOrCreateProfile short-circuits before
			// touching the betterAuth component (not registered in this test harness).
			await ctx.db.insert('profiles', {
				authUserId: 'new-guide-user',
				isVerified: true,
				firstLoginCompleted: false,
				updatedAt: Date.now()
			});
		});

		const identity = { subject: 'new-guide-user' };
		const result = await t
			.withIdentity(identity)
			.mutation(api.clubs.createClub, { name: 'Brand New Club' });

		const club = await t.run((ctx) => ctx.db.get(result.clubId));
		expect(club?.discoverable).toBe(false);
	});

	it('listPublicClubs only returns discoverable clubs with a code', async () => {
		const { t, clubId: nonDiscoverableClubId } = await seedClubPermissionFixture();

		const discoverableClubId = await t.run(async (ctx) => {
			const guideProfileId = await ctx.db.insert('profiles', {
				authUserId: 'guide-user-2',
				isVerified: true,
				firstLoginCompleted: true,
				updatedAt: Date.now()
			});
			return await ctx.db.insert('clubs', {
				name: 'Discoverable Club',
				clubCode: 'ABCDEF',
				discoverable: true,
				createdByProfileId: guideProfileId,
				createdAt: Date.now(),
				updatedAt: Date.now()
			});
		});

		await t.run(async (ctx) => {
			await ctx.db.patch(nonDiscoverableClubId, { clubCode: 'ZZZZZZ', discoverable: false });
		});

		const publicClubs = await t.query(api.clubs.listPublicClubs, {});
		const ids = publicClubs.map((club) => club.id);

		expect(ids).toContain(discoverableClubId);
		expect(ids).not.toContain(nonDiscoverableClubId);
	});

	it('getClubPreviewByCode keeps working for non-discoverable clubs', async () => {
		const { t, clubId } = await seedClubPermissionFixture();
		await t.run(async (ctx) => {
			await ctx.db.patch(clubId, { clubCode: 'NDCLUB', discoverable: false });
		});

		const preview = await t.query(api.clubs.getClubPreviewByCode, { code: 'NDCLUB' });
		expect(preview?.id).toBe(clubId);
	});
});

describe('club code rate limiting', () => {
	// Rate-limited code paths return structured results instead of throwing: a throwing
	// Convex mutation rolls back ALL of its writes (including scheduler calls), so a limiter
	// that threw from the same mutation could never persist failed-attempt counts.
	it('blocks joinClubWithCode after too many failed attempts by the same user', async () => {
		const { t, clubId } = await seedClubPermissionFixture();
		await t.run(async (ctx) => {
			await ctx.db.patch(clubId, { clubCode: 'RLTEST' });
		});

		const identity = { subject: 'rate-limited-user' };
		// Use a wrong code repeatedly to trigger the limiter without actually joining.
		for (let attempt = 0; attempt < 20; attempt += 1) {
			const result = await t
				.withIdentity(identity)
				.mutation(api.clubs.joinClubWithCode, { code: 'WRONGX' });
			expect(result).toEqual({ ok: false, error: 'invalid_code' });
		}

		// Even a valid code is now rejected for this user within the window.
		const blocked = await t
			.withIdentity(identity)
			.mutation(api.clubs.joinClubWithCode, { code: 'RLTEST' });
		expect(blocked).toEqual({ ok: false, error: 'rate_limited' });
	});

	it('does not count successful joins as failed attempts', async () => {
		const { t, clubId } = await seedClubPermissionFixture();
		await t.run(async (ctx) => {
			await ctx.db.patch(clubId, { clubCode: 'RLTEST' });
			// Pre-seed the profile so joinClubWithCode's getOrCreateProfile short-circuits
			// before touching the betterAuth component (not registered in this harness).
			await ctx.db.insert('profiles', {
				authUserId: 'joining-user',
				isVerified: true,
				firstLoginCompleted: false,
				updatedAt: Date.now()
			});
		});

		const result = await t
			.withIdentity({ subject: 'joining-user' })
			.mutation(api.clubs.joinClubWithCode, { code: 'RLTEST' });
		expect(result).toMatchObject({ ok: true, clubId });

		const rows = await t.run((ctx) => ctx.db.query('rateLimits').collect());
		expect(rows).toEqual([]);
	});

	it('checkClubCodeLookupRateLimit blocks unauthenticated lookups after the global window is exceeded', async () => {
		const t = convexTest(schema, modules);

		for (let attempt = 0; attempt < 30; attempt += 1) {
			const result = await t.mutation(api.clubs.checkClubCodeLookupRateLimit, {
				code: 'SAMECODE'
			});
			expect(result).toEqual({ ok: true });
		}

		const blocked = await t.mutation(api.clubs.checkClubCodeLookupRateLimit, {
			code: 'SAMECODE'
		});
		expect(blocked).toEqual({ ok: false, error: 'rate_limited' });
	});

	it('checkClubCodeLookupRateLimit tracks authenticated users separately from the global window', async () => {
		const t = convexTest(schema, modules);

		for (let attempt = 0; attempt < 20; attempt += 1) {
			const result = await t
				.withIdentity({ subject: 'lookup-user' })
				.mutation(api.clubs.checkClubCodeLookupRateLimit, { code: 'ANYCODE' });
			expect(result).toEqual({ ok: true });
		}

		const blocked = await t
			.withIdentity({ subject: 'lookup-user' })
			.mutation(api.clubs.checkClubCodeLookupRateLimit, { code: 'ANYCODE' });
		expect(blocked).toEqual({ ok: false, error: 'rate_limited' });
	});
});
