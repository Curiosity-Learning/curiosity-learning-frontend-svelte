/// <reference types="vite/client" />

import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';
import {
	clearPendingClubJoinsForProfile,
	getLatestPendingClubJoin,
	setPendingClubJoin
} from './pendingClubJoinsModel';

const modules = import.meta.glob('./**/*.ts');

const seedClubAndProfile = async (t: ReturnType<typeof convexTest>, authUserId: string) => {
	const now = Date.now();
	return await t.run(async (ctx) => {
		await ctx.db.insert('clubRoles', {
			key: 'guide',
			name: 'Guide',
			permissions: ['club:read'],
			order: 0,
			createdAt: now
		});
		await ctx.db.insert('clubRoles', {
			key: 'learner',
			name: 'Learner',
			permissions: ['club:read'],
			order: 1,
			createdAt: now
		});
		const profileId = await ctx.db.insert('profiles', {
			authUserId,
			isVerified: true,
			firstLoginCompleted: true,
			updatedAt: now
		});
		const guideProfileId = await ctx.db.insert('profiles', {
			authUserId: `${authUserId}-guide`,
			isVerified: true,
			firstLoginCompleted: true,
			updatedAt: now
		});
		const clubId = await ctx.db.insert('clubs', {
			name: 'Test Club',
			clubCode: 'ABCDEF',
			discoverable: false,
			createdByProfileId: guideProfileId,
			createdAt: now,
			updatedAt: now
		});
		return { profileId, clubId };
	});
};

describe('pendingClubJoinsModel', () => {
	it('set/get/clear round-trip', async () => {
		const t = convexTest(schema, modules);
		const { profileId, clubId } = await seedClubAndProfile(t, 'user-a');

		await t.run((ctx) => setPendingClubJoin(ctx, profileId, clubId, 'code'));
		const latest = await t.run((ctx) => getLatestPendingClubJoin(ctx, profileId));
		expect(latest).toMatchObject({ profileId, clubId, source: 'code' });

		await t.run((ctx) => clearPendingClubJoinsForProfile(ctx, profileId));
		const afterClear = await t.run((ctx) => getLatestPendingClubJoin(ctx, profileId));
		expect(afterClear).toBeNull();
	});

	it('setPendingClubJoin replaces any existing pending intent (only ever one live row)', async () => {
		const t = convexTest(schema, modules);
		const { profileId, clubId: firstClubId } = await seedClubAndProfile(t, 'user-b');
		const secondClubId = await t.run(async (ctx) => {
			const now = Date.now();
			const guideProfileId = await ctx.db.insert('profiles', {
				authUserId: 'user-b-guide-2',
				isVerified: true,
				firstLoginCompleted: true,
				updatedAt: now
			});
			return await ctx.db.insert('clubs', {
				name: 'Second Club',
				clubCode: 'ZZYYXX',
				discoverable: false,
				createdByProfileId: guideProfileId,
				createdAt: now,
				updatedAt: now
			});
		});

		await t.run((ctx) => setPendingClubJoin(ctx, profileId, firstClubId, 'code'));
		await t.run((ctx) => setPendingClubJoin(ctx, profileId, secondClubId, 'map_request'));

		const rows = await t.run((ctx) =>
			ctx.db
				.query('pendingClubJoins')
				.withIndex('by_profile', (q) => q.eq('profileId', profileId))
				.collect()
		);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ clubId: secondClubId, source: 'map_request' });
	});
});

describe('pendingClubJoins.getMine / consumeMine', () => {
	it('getMine returns null with no pending intent', async () => {
		const t = convexTest(schema, modules);
		await seedClubAndProfile(t, 'user-c');
		const mine = await t.withIdentity({ subject: 'user-c' }).query(api.pendingClubJoins.getMine, {});
		expect(mine).toBeNull();
	});

	it('getMine surfaces the pending intent, and consumeMine joins the club and clears it', async () => {
		const t = convexTest(schema, modules);
		const { profileId, clubId } = await seedClubAndProfile(t, 'user-d');
		await t.run((ctx) => setPendingClubJoin(ctx, profileId, clubId, 'code'));

		const asUser = t.withIdentity({ subject: 'user-d' });
		const mine = await asUser.query(api.pendingClubJoins.getMine, {});
		expect(mine).toMatchObject({ clubId, source: 'code' });

		const result = await asUser.mutation(api.pendingClubJoins.consumeMine, {});
		expect(result).toMatchObject({ ok: true, clubId });

		const membership = await t.run((ctx) =>
			ctx.db
				.query('clubMembers')
				.withIndex('by_club_and_profile', (q) => q.eq('clubId', clubId).eq('profileId', profileId))
				.first()
		);
		expect(membership).not.toBeNull();

		const afterConsume = await t.run((ctx) => getLatestPendingClubJoin(ctx, profileId));
		expect(afterConsume).toBeNull();

		const mineAfter = await asUser.query(api.pendingClubJoins.getMine, {});
		expect(mineAfter).toBeNull();
	});

	it('consumeMine reports no_pending when there is nothing to consume', async () => {
		const t = convexTest(schema, modules);
		await seedClubAndProfile(t, 'user-e');
		const result = await t
			.withIdentity({ subject: 'user-e' })
			.mutation(api.pendingClubJoins.consumeMine, {});
		expect(result).toEqual({ ok: false, error: 'no_pending' });
	});

	it('consumeMine reports club_unavailable and clears the pending row when the target club was abandoned', async () => {
		const t = convexTest(schema, modules);
		const { profileId, clubId } = await seedClubAndProfile(t, 'user-f');
		await t.run(async (ctx) => {
			await ctx.db.patch(clubId, { abandonedAt: Date.now() });
			await setPendingClubJoin(ctx, profileId, clubId, 'code');
		});

		const result = await t
			.withIdentity({ subject: 'user-f' })
			.mutation(api.pendingClubJoins.consumeMine, {});
		expect(result).toEqual({ ok: false, error: 'club_unavailable' });

		const afterConsume = await t.run((ctx) => getLatestPendingClubJoin(ctx, profileId));
		expect(afterConsume).toBeNull();
	});

	it('a code-join deferral has no join-request chat, so consumeMine returns roomId: null', async () => {
		const t = convexTest(schema, modules);
		const { profileId, clubId } = await seedClubAndProfile(t, 'user-g');
		await t.run((ctx) => setPendingClubJoin(ctx, profileId, clubId, 'code'));

		const result = await t
			.withIdentity({ subject: 'user-g' })
			.mutation(api.pendingClubJoins.consumeMine, {});
		expect(result).toMatchObject({ ok: true, clubId, roomId: null });
	});

	// CL-711 CEO review round 3: a visitor who requested to join from the map, signed up, and had
	// the Guide accept the request while onboarding gates were still pending gets a deferred
	// ('map_request') pendingClubJoins row. Once consumeMine runs (post-signup completeOnboarding),
	// the client should be able to jump straight back into the join-request chat rather than the
	// generic club overview — so consumeMine must resolve that chat's roomId.
	it('a map join-request deferral resolves the join-request chat roomId once consumed', async () => {
		const t = convexTest(schema, modules);
		const now = Date.now();
		const { requesterProfileId, clubId } = await t.run(async (ctx) => {
			const guideRoleId = await ctx.db.insert('clubRoles', {
				key: 'guide',
				name: 'Guide',
				permissions: ['club:read', 'club_join_request:decide'],
				order: 0,
				createdAt: now
			});
			await ctx.db.insert('clubRoles', {
				key: 'learner',
				name: 'Learner',
				permissions: ['club:read'],
				order: 1,
				createdAt: now
			});
			const guideProfileId = await ctx.db.insert('profiles', {
				authUserId: 'guide-user-h',
				isVerified: true,
				firstLoginCompleted: true,
				updatedAt: now
			});
			// Gate incomplete (pledge not yet agreed) — mirrors a visitor mid-signup.
			const requesterProfileId = await ctx.db.insert('profiles', {
				authUserId: 'requester-user-h',
				isVerified: true,
				firstLoginCompleted: false,
				updatedAt: now
			});
			const clubId = await ctx.db.insert('clubs', {
				name: 'Discoverable Club',
				clubCode: 'DISC01',
				discoverable: true,
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
			return { guideProfileId, requesterProfileId, clubId, guideRoleId };
		});

		const guide = t.withIdentity({ subject: 'guide-user-h' });
		const requester = t.withIdentity({ subject: 'requester-user-h' });

		const { joinRequestId, roomId: joinRequestRoomId } = await requester.mutation(
			api.joinRequests.requestToJoin,
			{ clubId }
		);
		const acceptResult = await guide.mutation(api.joinRequests.acceptJoinRequest, { joinRequestId });
		expect(acceptResult).toMatchObject({ success: true, membershipCreated: false });

		// Onboarding gate clears (post-signup completeOnboarding) — consumeMine now runs.
		await t.run((ctx) => ctx.db.patch(requesterProfileId, { firstLoginCompleted: true }));
		const result = await requester.mutation(api.pendingClubJoins.consumeMine, {});

		expect(result).toMatchObject({ ok: true, clubId, roomId: joinRequestRoomId });

		const membership = await t.run((ctx) =>
			ctx.db
				.query('clubMembers')
				.withIndex('by_club_and_profile', (q) => q.eq('clubId', clubId).eq('profileId', requesterProfileId))
				.first()
		);
		expect(membership).not.toBeNull();
	});
});
