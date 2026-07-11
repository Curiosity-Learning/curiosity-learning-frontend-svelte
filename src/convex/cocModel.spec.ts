import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { api, internal } from './_generated/api';
import schema from './schema';
import type { Id } from './_generated/dataModel';
import { approximateTimezoneOffsetFromLongitude } from './cocModel';

const modules = import.meta.glob('./**/*.ts');

const GUIDE_PERMISSIONS = [
	'club:read',
	'club:edit',
	'club_member:read_active',
	'club_member:kick',
	'club_member:promote'
];
const LEARNER_PERMISSIONS = ['club:read', 'club_member:read_active'];

const seedRoles = async (t: ReturnType<typeof convexTest>) => {
	await t.run(async (ctx) => {
		await ctx.db.insert('clubRoles', {
			key: 'guide',
			name: 'Guide',
			permissions: GUIDE_PERMISSIONS,
			order: 10,
			createdAt: Date.now()
		});
		await ctx.db.insert('clubRoles', {
			key: 'learner',
			name: 'Learner',
			permissions: LEARNER_PERMISSIONS,
			order: 100,
			createdAt: Date.now()
		});
	});
};

const seedProfile = async (t: ReturnType<typeof convexTest>, authUserId: string) => {
	return await t.run(async (ctx) => {
		return await ctx.db.insert('profiles', {
			authUserId,
			isVerified: true,
			firstLoginCompleted: false,
			updatedAt: Date.now()
		});
	});
};

describe('approximateTimezoneOffsetFromLongitude', () => {
	it('rounds longitude / 15 to the nearest hour', () => {
		expect(approximateTimezoneOffsetFromLongitude(-9.14)).toBe(-1); // Lisbon
		expect(approximateTimezoneOffsetFromLongitude(11.58)).toBe(1); // Munich
		expect(approximateTimezoneOffsetFromLongitude(139)).toBe(9); // Tokyo
	});

	it('defaults to 0 when no longitude is available', () => {
		expect(approximateTimezoneOffsetFromLongitude(undefined)).toBe(0);
	});
});

describe('Club of Clubs auto-assignment on launch', () => {
	it('creates a new CoC group when none exists', async () => {
		const t = convexTest(schema, modules);
		await seedRoles(t);
		await seedProfile(t, 'guide-a');

		const result = await t
			.withIdentity({ subject: 'guide-a' })
			.mutation(api.clubs.createClub, {
				name: 'Lisbon Club',
				locationLongitude: -9.14,
				locationLatitude: 38.7
			});

		const club = await t.run((ctx) => ctx.db.get(result.clubId));
		expect(club?.kind).toBe('curiosity');
		expect(club?.cocGroupId).toBeDefined();

		const cocGroup = await t.run((ctx) => ctx.db.get(club!.cocGroupId!));
		expect(cocGroup?.kind).toBe('coc');
		expect(cocGroup?.name).toContain('Club of Clubs');
		expect(cocGroup?.timezoneOffset).toBe(-1);
		expect(cocGroup?.discoverable).toBe(false);

		// The creating Guide is added as a guide member of the new CoC group.
		const membership = await t.run((ctx) =>
			ctx.db
				.query('clubMembers')
				.withIndex('by_club', (q) => q.eq('clubId', cocGroup!._id))
				.collect()
		);
		expect(membership).toHaveLength(1);

		// CoC groups get a chat room too (reuse of ensureClubRoom).
		const room = await t.run((ctx) =>
			ctx.db
				.query('rooms')
				.withIndex('by_club_id', (q) => q.eq('clubId', cocGroup!._id))
				.first()
		);
		expect(room).not.toBeNull();
	});

	it('joins an existing compatible CoC group (same-ish timezone, under capacity)', async () => {
		const t = convexTest(schema, modules);
		await seedRoles(t);
		await seedProfile(t, 'guide-a');
		await seedProfile(t, 'guide-b');

		const first = await t
			.withIdentity({ subject: 'guide-a' })
			.mutation(api.clubs.createClub, {
				name: 'Lisbon Club',
				locationLongitude: -9.14
			});
		const firstClub = await t.run((ctx) => ctx.db.get(first.clubId));

		// Madrid: ~ -3.7 longitude -> offset 0, well within +/-3h of Lisbon's -1.
		const second = await t
			.withIdentity({ subject: 'guide-b' })
			.mutation(api.clubs.createClub, {
				name: 'Madrid Club',
				locationLongitude: -3.7
			});
		const secondClub = await t.run((ctx) => ctx.db.get(second.clubId));

		expect(secondClub?.cocGroupId).toBe(firstClub?.cocGroupId);

		const members = await t.run((ctx) =>
			ctx.db
				.query('clubMembers')
				.withIndex('by_club', (q) => q.eq('clubId', firstClub!.cocGroupId!))
				.collect()
		);
		expect(members).toHaveLength(2);
	});

	it('creates a new group when the only existing group is out of timezone range', async () => {
		const t = convexTest(schema, modules);
		await seedRoles(t);
		await seedProfile(t, 'guide-a');
		await seedProfile(t, 'guide-b');

		const first = await t
			.withIdentity({ subject: 'guide-a' })
			.mutation(api.clubs.createClub, {
				name: 'Lisbon Club',
				locationLongitude: -9.14 // offset -1
			});
		const firstClub = await t.run((ctx) => ctx.db.get(first.clubId));

		const second = await t
			.withIdentity({ subject: 'guide-b' })
			.mutation(api.clubs.createClub, {
				name: 'Tokyo Club',
				locationLongitude: 139 // offset 9, diff 10 > 3
			});
		const secondClub = await t.run((ctx) => ctx.db.get(second.clubId));

		expect(secondClub?.cocGroupId).not.toBe(firstClub?.cocGroupId);
	});

	it('creates a new group when the only compatible group is already at capacity', async () => {
		const t = convexTest(schema, modules);
		await seedRoles(t);

		let firstClubId: Id<'clubs'> | null = null;
		let firstCocGroupId: Id<'clubs'> | null = null;
		for (let i = 0; i < 10; i += 1) {
			const authUserId = `guide-cap-${i}`;
			await seedProfile(t, authUserId);
			const result = await t
				.withIdentity({ subject: authUserId })
				.mutation(api.clubs.createClub, {
					name: `Club ${i}`,
					locationLongitude: -9.14
				});
			if (i === 0) {
				firstClubId = result.clubId;
				const club = await t.run((ctx) => ctx.db.get(result.clubId));
				firstCocGroupId = club!.cocGroupId!;
			}
		}
		expect(firstClubId).toBeDefined();

		// The group formed by the first 10 clubs is now at capacity (10 member clubs).
		const memberCount = await t.run(async (ctx) => {
			const clubs = await ctx.db
				.query('clubs')
				.withIndex('by_coc_group', (q) => q.eq('cocGroupId', firstCocGroupId!))
				.collect();
			return clubs.length;
		});
		expect(memberCount).toBe(10);

		await seedProfile(t, 'guide-overflow');
		const overflow = await t
			.withIdentity({ subject: 'guide-overflow' })
			.mutation(api.clubs.createClub, {
				name: 'Overflow Club',
				locationLongitude: -9.14
			});
		const overflowClub = await t.run((ctx) => ctx.db.get(overflow.clubId));
		expect(overflowClub?.cocGroupId).not.toBe(firstCocGroupId);
	});
});

describe('Club of Clubs membership on later guide additions', () => {
	const seedClubWithCocGroup = async () => {
		const t = convexTest(schema, modules);
		await seedRoles(t);
		await seedProfile(t, 'founder');

		const result = await t
			.withIdentity({ subject: 'founder' })
			.mutation(api.clubs.createClub, { name: 'Origin Club', locationLongitude: -9.14 });
		const club = await t.run((ctx) => ctx.db.get(result.clubId));

		return { t, clubId: result.clubId, cocGroupId: club!.cocGroupId! };
	};

	it('adds a member who is promoted to Guide to the CoC group', async () => {
		const { t, clubId, cocGroupId } = await seedClubWithCocGroup();

		await seedProfile(t, 'learner-user');
		const learnerCode = await t.run((ctx) => ctx.db.get(clubId)).then((c) => c!.clubCode!);
		await t.withIdentity({ subject: 'learner-user' }).mutation(api.clubs.joinClubWithCode, {
			code: learnerCode
		});

		const learnerProfile = await t.run((ctx) =>
			ctx.db
				.query('profiles')
				.withIndex('by_auth_user_id', (q) => q.eq('authUserId', 'learner-user'))
				.unique()
		);
		const learnerMembership = await t.run((ctx) =>
			ctx.db
				.query('clubMembers')
				.withIndex('by_club_and_profile', (q) =>
					q.eq('clubId', clubId).eq('profileId', learnerProfile!._id)
				)
				.collect()
		);

		await t.withIdentity({ subject: 'founder' }).mutation(api.clubs.promoteMember, {
			clubMemberId: learnerMembership[0]._id
		});

		const cocMembership = await t.run((ctx) =>
			ctx.db
				.query('clubMembers')
				.withIndex('by_club_and_profile', (q) =>
					q.eq('clubId', cocGroupId).eq('profileId', learnerProfile!._id)
				)
				.collect()
		);
		expect(cocMembership.filter((m) => !m.leftAt)).toHaveLength(1);
	});
});

describe('Club of Clubs exclusion from discovery', () => {
	it('excludes CoC groups from listPublicClubs even if somehow discoverable with a code', async () => {
		const t = convexTest(schema, modules);
		await seedRoles(t);
		const founderProfileId = await seedProfile(t, 'founder');

		const cocGroupId = await t.run(async (ctx) => {
			const now = Date.now();
			return await ctx.db.insert('clubs', {
				name: 'Club of Clubs — Group 1',
				clubCode: 'COCCOD',
				discoverable: true, // deliberately misconfigured to prove the kind check holds
				kind: 'coc',
				createdByProfileId: founderProfileId,
				createdAt: now,
				updatedAt: now
			});
		});

		const publicClubs = await t.query(api.clubs.listPublicClubs, {});
		expect(publicClubs.some((club) => club.id === cocGroupId)).toBe(false);
	});
});

describe('backfillClubKind', () => {
	it('assigns kind "curiosity" only to clubs missing a kind', async () => {
		const t = convexTest(schema, modules);
		const founderProfileId = await seedProfile(t, 'founder');

		const legacyClubId = await t.run(async (ctx) => {
			const now = Date.now();
			return await ctx.db.insert('clubs', {
				name: 'Legacy Club',
				discoverable: false,
				createdByProfileId: founderProfileId,
				createdAt: now,
				updatedAt: now
			});
		});
		const alreadyCocGroupId = await t.run(async (ctx) => {
			const now = Date.now();
			return await ctx.db.insert('clubs', {
				name: 'Already CoC',
				discoverable: false,
				kind: 'coc',
				createdByProfileId: founderProfileId,
				createdAt: now,
				updatedAt: now
			});
		});

		const result = await t.mutation(internal.clubs.backfillClubKind, {});
		expect(result.updated).toBe(1);

		const legacyClub = await t.run((ctx) => ctx.db.get(legacyClubId));
		expect(legacyClub?.kind).toBe('curiosity');

		const cocClub = await t.run((ctx) => ctx.db.get(alreadyCocGroupId));
		expect(cocClub?.kind).toBe('coc');
	});
});
