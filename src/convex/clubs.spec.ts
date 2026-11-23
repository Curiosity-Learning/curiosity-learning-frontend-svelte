import { convexTest } from 'convex-test';
import rateLimiterTest from '@convex-dev/rate-limiter/test';
import betterAuthTest from '@convex-dev/better-auth/test';
import { describe, expect, it } from 'vitest';
import { api, components } from './_generated/api';
import schema from './schema';
import type { Id } from './_generated/dataModel';

const modules = import.meta.glob('./**/*.ts');

// Every test convex instance needs the rate-limiter component (lookupClubByCode uses it).
const newTestConvex = () => {
	const t = convexTest(schema, modules);
	rateLimiterTest.register(t);
	return t;
};

const seedClubPermissionFixture = async () => {
	const t = newTestConvex();
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
	it('createClub defaults new clubs to discoverable', async () => {
		const t = newTestConvex();
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
		expect(club?.discoverable).toBe(true);
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

	// Regression test for a security bug (CL-711): listPublicClubs previously returned each
	// club's clubCode, letting any user bypass the request-to-join flow and instantly join
	// any discoverable club. Codes are Guide-only secrets (PRD 6.1.3) and must never appear
	// in this public discovery listing.
	it('listPublicClubs never includes clubCode or code fields', async () => {
		const { t } = await seedClubPermissionFixture();

		await t.run(async (ctx) => {
			const guideProfileId = await ctx.db.insert('profiles', {
				authUserId: 'guide-user-3',
				isVerified: true,
				firstLoginCompleted: true,
				updatedAt: Date.now()
			});
			await ctx.db.insert('clubs', {
				name: 'Discoverable Club Without Leaked Code',
				clubCode: 'SECRET',
				discoverable: true,
				createdByProfileId: guideProfileId,
				createdAt: Date.now(),
				updatedAt: Date.now()
			});
		});

		const publicClubs = await t.query(api.clubs.listPublicClubs, {});
		expect(publicClubs.length).toBeGreaterThan(0);
		for (const club of publicClubs) {
			expect('code' in club).toBe(false);
			expect('clubCode' in club).toBe(false);
		}
	});

	it('lookupClubByCode keeps working for non-discoverable clubs', async () => {
		const { t, clubId } = await seedClubPermissionFixture();
		await t.run(async (ctx) => {
			await ctx.db.patch(clubId, { clubCode: 'NDCLUB', discoverable: false });
		});

		const preview = await t.mutation(api.clubs.lookupClubByCode, { code: 'NDCLUB' });
		expect(preview.ok && preview.club?.id).toBe(clubId);
	});

	it('lookupClubByCode still returns the full schedule slots (gated behind knowing the code)', async () => {
		const { t, clubId } = await seedClubPermissionFixture();
		await t.run(async (ctx) => {
			await ctx.db.patch(clubId, { clubCode: 'FULLCD', discoverable: false });
			await ctx.db.insert('clubScheduleSlots', {
				clubId,
				dayOfWeek: 'monday',
				startTime: '16:00',
				endTime: '17:30',
				location: '221B Baker Street, Room 4',
				createdAt: Date.now(),
				updatedAt: Date.now()
			});
		});

		const preview = await t.mutation(api.clubs.lookupClubByCode, { code: 'FULLCD' });
		expect(preview.ok && preview.club?.scheduleSlots).toEqual([
			expect.objectContaining({ location: '221B Baker Street, Room 4' })
		]);
	});

	// CEO decision: public/discoverable surfaces only ever show a coarse city and stripped
	// schedule times, never the exact free-text location or a schedule slot's exact address.
	it('listPublicClubs coarsens location to a city and strips schedule-slot addresses', async () => {
		const { t } = await seedClubPermissionFixture();

		const clubId = await t.run(async (ctx) => {
			const guideProfileId = await ctx.db.insert('profiles', {
				authUserId: 'guide-user-city',
				isVerified: true,
				firstLoginCompleted: true,
				updatedAt: Date.now()
			});
			const insertedClubId = await ctx.db.insert('clubs', {
				name: 'City Club',
				clubCode: 'CITYCD',
				discoverable: true,
				location:
					'Amsterdam International Community School, Amsterdam, Zuid, North Holland, Netherlands',
				createdByProfileId: guideProfileId,
				createdAt: Date.now(),
				updatedAt: Date.now()
			});
			await ctx.db.insert('clubScheduleSlots', {
				clubId: insertedClubId,
				dayOfWeek: 'monday',
				startTime: '16:00',
				endTime: '17:30',
				location: '221B Baker Street, Room 4',
				createdAt: Date.now(),
				updatedAt: Date.now()
			});
			return insertedClubId;
		});

		const publicClubs = await t.query(api.clubs.listPublicClubs, {});
		const club = publicClubs.find((entry) => entry.id === clubId);

		expect(club).toBeDefined();
		expect(club?.city).toBe('Amsterdam');
		expect(club && 'location' in club).toBe(false);
		expect(club?.scheduleSlots).toEqual([
			{ dayOfWeek: 'monday', startTime: '16:00', endTime: '17:30', location: '' }
		]);
	});
});

describe('getClubPreviewById', () => {
	it('returns null for a non-discoverable club', async () => {
		const { t, clubId } = await seedClubPermissionFixture();
		const preview = await t.query(api.clubs.getClubPreviewById, { clubId });
		expect(preview).toBeNull();
	});

	it('returns null for an abandoned club', async () => {
		const { t, clubId } = await seedClubPermissionFixture();
		await t.run((ctx) => ctx.db.patch(clubId, { discoverable: true, abandonedAt: Date.now() }));
		const preview = await t.query(api.clubs.getClubPreviewById, { clubId });
		expect(preview).toBeNull();
	});

	it('never includes a join code, only preview details', async () => {
		const { t, clubId } = await seedClubPermissionFixture();
		await t.run((ctx) => ctx.db.patch(clubId, { discoverable: true }));

		const preview = await t.query(api.clubs.getClubPreviewById, { clubId });

		expect(preview).toMatchObject({ id: clubId, viewerIsMember: false });
		expect(preview && 'code' in preview).toBe(false);
	});

	it('reports viewerIsMember and viewerPendingJoinRequestId for the caller', async () => {
		const { t, clubId } = await seedClubPermissionFixture();
		await t.run((ctx) => ctx.db.patch(clubId, { discoverable: true }));

		const learner = t.withIdentity({ subject: 'learner-user' });
		const memberPreview = await learner.query(api.clubs.getClubPreviewById, { clubId });
		expect(memberPreview).toMatchObject({ viewerIsMember: true, viewerPendingJoinRequestId: null });

		await t.run(async (ctx) => {
			const id = await ctx.db.insert('profiles', {
				authUserId: 'outsider-user',
				isVerified: true,
				firstLoginCompleted: true,
				updatedAt: Date.now()
			});
			await ctx.db.insert('joinRequests', {
				clubId,
				requesterProfileId: id,
				status: 'pending',
				createdAt: Date.now()
			});
		});
		const outsider = t.withIdentity({ subject: 'outsider-user' });
		const outsiderPreview = await outsider.query(api.clubs.getClubPreviewById, { clubId });
		expect(outsiderPreview?.viewerIsMember).toBe(false);
		expect(outsiderPreview?.viewerPendingJoinRequestId).not.toBeNull();
	});

	it('coarsens location to a city and strips schedule-slot addresses', async () => {
		const { t, clubId } = await seedClubPermissionFixture();
		await t.run(async (ctx) => {
			await ctx.db.patch(clubId, {
				discoverable: true,
				location: 'Munich, Bavaria, Germany'
			});
			await ctx.db.insert('clubScheduleSlots', {
				clubId,
				dayOfWeek: 'tuesday',
				startTime: '15:00',
				endTime: '16:00',
				location: 'Community Center, Room 2',
				createdAt: Date.now(),
				updatedAt: Date.now()
			});
		});

		const preview = await t.query(api.clubs.getClubPreviewById, { clubId });
		expect(preview?.city).toBe('Munich');
		expect(preview && 'location' in preview).toBe(false);
		expect(preview?.scheduleSlots).toEqual([
			{ dayOfWeek: 'tuesday', startTime: '15:00', endTime: '16:00', location: '' }
		]);
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

	// CL-708: guide invite codes were removed — joinClubWithCode has no way to request the
	// Guide role. Every code-based join lands as a Learner; promotion is the only path to Guide.
	it('joinClubWithCode always assigns the learner role, never guide', async () => {
		const { t, clubId } = await seedClubPermissionFixture();
		await t.run(async (ctx) => {
			await ctx.db.patch(clubId, { clubCode: 'LEARN1' });
			await ctx.db.insert('profiles', {
				authUserId: 'code-joiner',
				isVerified: true,
				firstLoginCompleted: false,
				updatedAt: Date.now()
			});
		});

		const result = await t
			.withIdentity({ subject: 'code-joiner' })
			.mutation(api.clubs.joinClubWithCode, { code: 'LEARN1' });
		expect(result).toMatchObject({ ok: true, clubId });

		const membership = await t.run(async (ctx) => {
			const profile = await ctx.db
				.query('profiles')
				.withIndex('by_auth_user_id', (q) => q.eq('authUserId', 'code-joiner'))
				.unique();
			const member = await ctx.db
				.query('clubMembers')
				.withIndex('by_club_and_profile', (q) =>
					q.eq('clubId', clubId).eq('profileId', profile!._id)
				)
				.unique();
			const role = member ? await ctx.db.get(member.roleId) : null;
			return { role };
		});

		expect(membership.role?.key).toBe('learner');
	});

	it('the club-code lookup functions without a rate limit are gone (CL-817)', async () => {
		// Before CL-817 the preview was a public query beside a separate, skippable rate-limit
		// mutation; anyone could call the query directly and guess codes without limit.
		const clubsModule: Record<string, unknown> = await import('./clubs');
		expect(clubsModule.lookupClubByCode).toBeDefined();
		expect(clubsModule.getClubPreviewByCode).toBeUndefined();
		expect(clubsModule.getClubPreviewDeliveryAssetByCode).toBeUndefined();
		expect(clubsModule.checkClubCodeLookupRateLimit).toBeUndefined();
	});

	it('lookupClubByCode returns the preview for a real code and null for an unknown one', async () => {
		const { t, clubId } = await seedClubPermissionFixture();
		await t.run(async (ctx) => {
			await ctx.db.patch(clubId, { clubCode: 'REALCD' });
		});

		const found = await t.mutation(api.clubs.lookupClubByCode, { code: 'realcd' });
		expect(found.ok && found.club?.id).toBe(clubId);

		const missing = await t.mutation(api.clubs.lookupClubByCode, { code: 'NOPE22' });
		expect(missing).toEqual({ ok: true, club: null });
	});

	it('lookupClubByCode rate limits one anonymous client by IP', async () => {
		const t = newTestConvex();
		const attacker = t.withRequestMetadata({ ip: '203.0.113.7' });

		for (let attempt = 0; attempt < 20; attempt += 1) {
			const result = await attacker.mutation(api.clubs.lookupClubByCode, {
				code: `GUESS${attempt % 10}`
			});
			expect(result.ok).toBe(true);
		}

		const blocked = await attacker.mutation(api.clubs.lookupClubByCode, { code: 'GUESSX' });
		expect(blocked).toEqual({ ok: false, error: 'rate_limited' });
	});

	it('lookupClubByCode rate limits one signed-in user, whatever their IP', async () => {
		const t = newTestConvex();
		for (let attempt = 0; attempt < 20; attempt += 1) {
			const result = await t
				.withIdentity({ subject: 'lookup-user' })
				.withRequestMetadata({ ip: `198.51.100.${attempt}` })
				.mutation(api.clubs.lookupClubByCode, { code: 'ANYCOD' });
			expect(result.ok).toBe(true);
		}

		const blocked = await t
			.withIdentity({ subject: 'lookup-user' })
			.withRequestMetadata({ ip: '198.51.100.250' })
			.mutation(api.clubs.lookupClubByCode, { code: 'ANYCOD' });
		expect(blocked).toEqual({ ok: false, error: 'rate_limited' });
	});

	it('lookupClubByCode keeps users and IPs isolated from each other', async () => {
		const t = newTestConvex();
		for (let attempt = 0; attempt < 21; attempt += 1) {
			await t
				.withIdentity({ subject: 'noisy-user' })
				.mutation(api.clubs.lookupClubByCode, { code: 'ANYCOD' });
			await t
				.withRequestMetadata({ ip: '203.0.113.7' })
				.mutation(api.clubs.lookupClubByCode, { code: 'ANYCOD' });
		}

		const otherUser = await t
			.withIdentity({ subject: 'quiet-user' })
			.mutation(api.clubs.lookupClubByCode, { code: 'ANYCOD' });
		expect(otherUser.ok).toBe(true);

		const otherIp = await t
			.withRequestMetadata({ ip: '192.0.2.1' })
			.mutation(api.clubs.lookupClubByCode, { code: 'ANYCOD' });
		expect(otherIp.ok).toBe(true);
	});

	it('one attacker hammering a real code cannot lock others out of it', async () => {
		const { t, clubId } = await seedClubPermissionFixture();
		await t.run(async (ctx) => {
			await ctx.db.patch(clubId, { clubCode: 'REALCD' });
		});

		// Before CL-817 anonymous lookups were keyed per code (30 a minute), so this used the
		// code up for everyone.
		const attacker = t.withRequestMetadata({ ip: '203.0.113.7' });
		for (let attempt = 0; attempt < 40; attempt += 1) {
			await attacker.mutation(api.clubs.lookupClubByCode, { code: 'REALCD' });
		}
		expect(await attacker.mutation(api.clubs.lookupClubByCode, { code: 'REALCD' })).toEqual({
			ok: false,
			error: 'rate_limited'
		});

		const anonymousJoiner = await t
			.withRequestMetadata({ ip: '192.0.2.55' })
			.mutation(api.clubs.lookupClubByCode, { code: 'REALCD' });
		expect(anonymousJoiner.ok && anonymousJoiner.club?.id).toBe(clubId);

		const signedInJoiner = await t
			.withIdentity({ subject: 'real-joiner' })
			.mutation(api.clubs.lookupClubByCode, { code: 'REALCD' });
		expect(signedInJoiner.ok && signedInJoiner.club?.id).toBe(clubId);
	});

	it('lookupClubByCode stops every caller once the global backstop is used up', async () => {
		const t = newTestConvex();
		// 600 a minute in total: 30 distinct IPs, 20 lookups each.
		for (let client = 0; client < 30; client += 1) {
			const caller = t.withRequestMetadata({ ip: `10.0.0.${client}` });
			for (let attempt = 0; attempt < 20; attempt += 1) {
				const result = await caller.mutation(api.clubs.lookupClubByCode, { code: 'ANYCOD' });
				expect(result.ok).toBe(true);
			}
		}

		const fresh = await t
			.withRequestMetadata({ ip: '10.0.1.1' })
			.mutation(api.clubs.lookupClubByCode, { code: 'ANYCOD' });
		expect(fresh).toEqual({ ok: false, error: 'rate_limited' });
	});

	it('getClubVideoDeliveryAsset only resolves the video of a live club', async () => {
		const { t, clubId } = await seedClubPermissionFixture();
		const { clubVideoId, strayVideoId } = await t.run(async (ctx) => {
			const base = {
				ownerUserId: 'guide-user',
				storageProvider: 's3' as const,
				sourceBucket: 'bucket',
				status: 'ready' as const,
				mediaKind: 'video' as const,
				contentType: 'video/mp4',
				acceptedContentTypes: ['video/mp4'],
				maxBytes: 1_000_000,
				enableCompression: false,
				enableSafetyScreening: false,
				sourceObjectRevision: 1,
				pipelineVersion: 1,
				attemptCount: 0,
				stepResults: [],
				createdAt: Date.now(),
				updatedAt: Date.now()
			};
			const clubVideoId = await ctx.db.insert('mediaAssets', {
				...base,
				sourceObjectKey: 'club.mp4'
			});
			const strayVideoId = await ctx.db.insert('mediaAssets', {
				...base,
				sourceObjectKey: 'stray.mp4'
			});
			await ctx.db.patch(clubId, { videoMediaAssetId: clubVideoId });
			return { clubVideoId, strayVideoId };
		});

		const clubVideo = await t.query(api.clubs.getClubVideoDeliveryAsset, {
			assetId: clubVideoId
		});
		expect(clubVideo?.deliveryObjectKey).toBe('club.mp4');

		expect(
			await t.query(api.clubs.getClubVideoDeliveryAsset, { assetId: strayVideoId })
		).toBeNull();

		await t.run(async (ctx) => {
			await ctx.db.patch(clubId, { abandonedAt: Date.now() });
		});
		expect(await t.query(api.clubs.getClubVideoDeliveryAsset, { assetId: clubVideoId })).toBeNull();
	});
});

// Mirrors the real dev clubRoles permission sets closely enough to exercise the governance
// mutations (kick/promote/demote/leave/abandon).
const GUIDE_PERMISSIONS = [
	'club:read',
	'club:edit',
	'club_member:read_active',
	'club_member:kick',
	'club_member:promote'
];
const LEARNER_PERMISSIONS = ['club:read', 'club_member:read_active'];

const seedGovernanceFixture = async (
	options: { guideCount?: number; learnerCount?: number } = {}
) => {
	const { guideCount = 1, learnerCount = 1 } = options;
	const t = newTestConvex();
	const now = Date.now();

	const ids = await t.run(async (ctx) => {
		const guideRoleId = await ctx.db.insert('clubRoles', {
			key: 'guide',
			name: 'Guide',
			permissions: GUIDE_PERMISSIONS,
			order: 10,
			createdAt: now
		});
		const learnerRoleId = await ctx.db.insert('clubRoles', {
			key: 'learner',
			name: 'Learner',
			permissions: LEARNER_PERMISSIONS,
			order: 100,
			createdAt: now
		});

		const guideProfileIds: Id<'profiles'>[] = [];
		for (let index = 0; index < guideCount; index += 1) {
			const profileId = await ctx.db.insert('profiles', {
				authUserId: `guide-user-${index}`,
				isVerified: true,
				firstLoginCompleted: true,
				updatedAt: now
			});
			guideProfileIds.push(profileId);
		}

		const learnerProfileIds: Id<'profiles'>[] = [];
		for (let index = 0; index < learnerCount; index += 1) {
			const profileId = await ctx.db.insert('profiles', {
				authUserId: `learner-user-${index}`,
				isVerified: true,
				firstLoginCompleted: true,
				updatedAt: now
			});
			learnerProfileIds.push(profileId);
		}

		const clubId = await ctx.db.insert('clubs', {
			name: 'Curiosity Club',
			clubCode: 'CLUBCD',
			discoverable: true,
			createdByProfileId: guideProfileIds[0],
			createdAt: now,
			updatedAt: now
		});

		const guideMemberIds: Id<'clubMembers'>[] = [];
		for (const profileId of guideProfileIds) {
			const memberId = await ctx.db.insert('clubMembers', {
				clubId,
				profileId,
				roleId: guideRoleId,
				createdAt: now
			});
			guideMemberIds.push(memberId);
		}

		const learnerMemberIds: Id<'clubMembers'>[] = [];
		for (const profileId of learnerProfileIds) {
			const memberId = await ctx.db.insert('clubMembers', {
				clubId,
				profileId,
				roleId: learnerRoleId,
				createdAt: now
			});
			learnerMemberIds.push(memberId);
		}

		return { clubId, guideMemberIds, learnerMemberIds, guideRoleId, learnerRoleId };
	});

	return { t, ...ids };
};

describe('kickMember', () => {
	it('requires a non-empty reason', async () => {
		const { t, learnerMemberIds } = await seedGovernanceFixture();

		await expect(
			t.withIdentity({ subject: 'guide-user-0' }).mutation(api.clubs.kickMember, {
				clubMemberId: learnerMemberIds[0],
				reason: '   '
			})
		).rejects.toThrow('A reason is required');
	});

	it('rejects reasons over 500 characters', async () => {
		const { t, learnerMemberIds } = await seedGovernanceFixture();

		await expect(
			t.withIdentity({ subject: 'guide-user-0' }).mutation(api.clubs.kickMember, {
				clubMemberId: learnerMemberIds[0],
				reason: 'x'.repeat(501)
			})
		).rejects.toThrow('500 characters or fewer');
	});

	it('kicks a learner, stores the reason, and notifies them', async () => {
		const { t, learnerMemberIds } = await seedGovernanceFixture();

		await t.withIdentity({ subject: 'guide-user-0' }).mutation(api.clubs.kickMember, {
			clubMemberId: learnerMemberIds[0],
			reason: 'Repeated no-shows'
		});

		const member = await t.run((ctx) => ctx.db.get(learnerMemberIds[0]));
		expect(member?.leftAt).toBeTypeOf('number');
		expect(member?.kickReason).toBe('Repeated no-shows');
		expect(member?.kickedByProfileId).toBeDefined();

		const notifications = await t.run((ctx) => ctx.db.query('notifications').collect());
		expect(notifications).toHaveLength(1);
		expect(notifications[0].message).toContain('Repeated no-shows');
	});

	it('does not allow a guide to kick another guide', async () => {
		const { t, guideMemberIds } = await seedGovernanceFixture({ guideCount: 2 });

		await expect(
			t.withIdentity({ subject: 'guide-user-0' }).mutation(api.clubs.kickMember, {
				clubMemberId: guideMemberIds[1],
				reason: 'Disagreement'
			})
		).rejects.toThrow('equal or higher role');
	});
});

describe('promoteMember', () => {
	it('promotes a learner to guide and notifies them', async () => {
		const { t, learnerMemberIds, guideRoleId } = await seedGovernanceFixture();

		await t.withIdentity({ subject: 'guide-user-0' }).mutation(api.clubs.promoteMember, {
			clubMemberId: learnerMemberIds[0]
		});

		const member = await t.run((ctx) => ctx.db.get(learnerMemberIds[0]));
		expect(member?.roleId).toBe(guideRoleId);

		const notifications = await t.run((ctx) => ctx.db.query('notifications').collect());
		expect(notifications).toHaveLength(1);
		expect(notifications[0].title).toBe('Promoted to Guide');
	});

	it('rejects promoting an already-promoted guide', async () => {
		const { t, guideMemberIds } = await seedGovernanceFixture({ guideCount: 2 });

		await expect(
			t.withIdentity({ subject: 'guide-user-0' }).mutation(api.clubs.promoteMember, {
				clubMemberId: guideMemberIds[1]
			})
		).rejects.toThrow('Only Learners can be promoted');
	});

	it('rejects a learner attempting to promote', async () => {
		const { t, learnerMemberIds } = await seedGovernanceFixture({ learnerCount: 2 });

		await expect(
			t.withIdentity({ subject: 'learner-user-0' }).mutation(api.clubs.promoteMember, {
				clubMemberId: learnerMemberIds[1]
			})
		).rejects.toThrow('Permission denied');
	});
});

describe('demoteSelfToLearner', () => {
	it('allows a guide to demote themselves when other guides remain', async () => {
		const { t, clubId, guideMemberIds, learnerRoleId } = await seedGovernanceFixture({
			guideCount: 2
		});

		await t
			.withIdentity({ subject: 'guide-user-0' })
			.mutation(api.clubs.demoteSelfToLearner, { clubId });

		const demotedMember = await t.run((ctx) => ctx.db.get(guideMemberIds[0]));
		expect(demotedMember?.roleId).toBe(learnerRoleId);

		const otherGuideMember = await t.run((ctx) => ctx.db.get(guideMemberIds[1]));
		expect(otherGuideMember?.roleId).not.toBe(learnerRoleId);
	});

	it('blocks self-demotion for the last guide when learners exist', async () => {
		const { t, clubId } = await seedGovernanceFixture({ guideCount: 1, learnerCount: 1 });

		await expect(
			t.withIdentity({ subject: 'guide-user-0' }).mutation(api.clubs.demoteSelfToLearner, {
				clubId
			})
		).rejects.toThrow('Promote a Learner to Guide first');
	});

	it('blocks self-demotion for the last guide with no learners (must use Leave instead)', async () => {
		const { t, clubId } = await seedGovernanceFixture({ guideCount: 1, learnerCount: 0 });

		await expect(
			t.withIdentity({ subject: 'guide-user-0' }).mutation(api.clubs.demoteSelfToLearner, {
				clubId
			})
		).rejects.toThrow('Use Leave club instead');
	});
});

describe('leaveClub', () => {
	it('lets a non-last guide leave freely', async () => {
		const { t, clubId } = await seedGovernanceFixture({ guideCount: 2, learnerCount: 1 });

		const result = await t
			.withIdentity({ subject: 'guide-user-0' })
			.mutation(api.clubs.leaveClub, { clubId });
		expect(result).toEqual({ success: true, abandoned: false });

		const club = await t.run((ctx) => ctx.db.get(clubId));
		expect(club?.abandonedAt).toBeUndefined();
	});

	it('blocks the last guide from leaving while learners exist', async () => {
		const { t, clubId } = await seedGovernanceFixture({ guideCount: 1, learnerCount: 1 });

		await expect(
			t.withIdentity({ subject: 'guide-user-0' }).mutation(api.clubs.leaveClub, { clubId })
		).rejects.toThrow('Promote a Learner to Guide before leaving');
	});

	it('allows the last guide with no learners to leave, abandoning the club', async () => {
		const { t, clubId } = await seedGovernanceFixture({ guideCount: 1, learnerCount: 0 });

		const result = await t
			.withIdentity({ subject: 'guide-user-0' })
			.mutation(api.clubs.leaveClub, { clubId });
		expect(result).toEqual({ success: true, abandoned: true });

		const club = await t.run((ctx) => ctx.db.get(clubId));
		expect(club?.abandonedAt).toBeTypeOf('number');
		expect(club?.clubCode).toBeUndefined();
		expect(club?.discoverable).toBe(false);
	});

	it('excludes abandoned clubs from listPublicClubs', async () => {
		const { t, clubId } = await seedGovernanceFixture({ guideCount: 1, learnerCount: 0 });

		await t.withIdentity({ subject: 'guide-user-0' }).mutation(api.clubs.leaveClub, { clubId });

		const publicClubs = await t.query(api.clubs.listPublicClubs, {});
		expect(publicClubs.map((club) => club.id)).not.toContain(clubId);
	});

	it('fails a code join for an abandoned club', async () => {
		const { t, clubId } = await seedGovernanceFixture({ guideCount: 1, learnerCount: 0 });

		await t.withIdentity({ subject: 'guide-user-0' }).mutation(api.clubs.leaveClub, { clubId });

		const preview = await t.mutation(api.clubs.lookupClubByCode, { code: 'CLUBCD' });
		expect(preview).toEqual({ ok: true, club: null });

		await t.run(async (ctx) => {
			await ctx.db.insert('profiles', {
				authUserId: 'joiner-user',
				isVerified: true,
				firstLoginCompleted: false,
				updatedAt: Date.now()
			});
		});
		const joinResult = await t
			.withIdentity({ subject: 'joiner-user' })
			.mutation(api.clubs.joinClubWithCode, { code: 'CLUBCD' });
		expect(joinResult).toEqual({ ok: false, error: 'invalid_code' });
	});
});

// CL-817 QA: completeSignupProfile resolves a club code from nextPath and getMine then reveals the
// match, so it is a code lookup too and must use up the same per-caller limit.
describe('completeSignupProfile with a club code in nextPath', () => {
	const signedUpUser = async (code = 'REALCD') => {
		const { t, clubId } = await seedClubPermissionFixture();
		betterAuthTest.register(t);
		await t.run(async (ctx) => {
			await ctx.db.patch(clubId, { clubCode: code });
		});
		const now = Date.now();
		const authUser = (await t.mutation(components.betterAuth.adapter.create, {
			input: {
				model: 'user',
				data: {
					email: 'joiner@example.com',
					emailVerified: true,
					name: 'Joiner Person',
					createdAt: now,
					updatedAt: now
				}
			}
		})) as { _id: string };
		const session = (await t.mutation(components.betterAuth.adapter.create, {
			input: {
				model: 'session',
				data: {
					token: 'joiner-session',
					userId: authUser._id,
					expiresAt: now + 24 * 60 * 60 * 1000,
					createdAt: now,
					updatedAt: now
				}
			}
		})) as { _id: string };
		return {
			t,
			clubId,
			user: t.withIdentity({ subject: authUser._id, sessionId: session._id })
		};
	};

	it('remembers the club for a normal signup', async () => {
		const { clubId, user } = await signedUpUser();
		await user.mutation(api.auth.completeSignupProfile, {
			signUpWith: 'email',
			nextPath: '/onboarding/join-club/realcd'
		});
		expect(await user.query(api.pendingClubJoins.getMine, {})).toEqual({
			clubId,
			source: 'code'
		});
	});

	it('throttles repeated probes, so getMine cannot be used to guess codes', async () => {
		const { user } = await signedUpUser();
		for (let attempt = 0; attempt < 20; attempt += 1) {
			await user.mutation(api.auth.completeSignupProfile, {
				signUpWith: 'email',
				nextPath: `/onboarding/join-club/GUES${String(attempt).padStart(2, '0')}`
			});
			expect(await user.query(api.pendingClubJoins.getMine, {})).toBeNull();
		}

		// The 21st probe hits the real code, but the limit is used up: signup still succeeds and
		// nothing about the club is revealed.
		const profile = await user.mutation(api.auth.completeSignupProfile, {
			signUpWith: 'email',
			nextPath: '/onboarding/join-club/REALCD'
		});
		expect(profile).not.toBeNull();
		expect(await user.query(api.pendingClubJoins.getMine, {})).toBeNull();
		expect(await user.mutation(api.clubs.lookupClubByCode, { code: 'REALCD' })).toEqual({
			ok: false,
			error: 'rate_limited'
		});
	});
});
