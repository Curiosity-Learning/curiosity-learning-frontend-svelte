/// <reference types="vite/client" />

import { convexTest } from 'convex-test';
import { describe, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';
import { LEADER_INVITE_TTL_MS } from './clubLeaderInvites';

const modules = import.meta.glob('./**/*.ts');

// The betterAuth component is not available in convex-test, so the auth-email lookup module is
// mocked with fixed maps, same pattern as adminInvites.spec.ts. `unverifiedUsers` lets tests
// exercise the emailVerified gate in claimMyLeaderInvite.
const { authEmailByUserId, unverifiedUsers } = vi.hoisted(() => ({
	authEmailByUserId: new Map<string, string>([
		['admin-user', 'admin@example.com'],
		['leader-user', 'leader@example.com'],
		['stranger-user', 'stranger@example.com'],
		['unverified-user', 'unverified@example.com']
	]),
	unverifiedUsers: new Set<string>(['unverified-user'])
}));

vi.mock('./authEmail', () => ({
	getAuthUserEmail: async (_ctx: unknown, authUserId: string) =>
		authEmailByUserId.get(authUserId) ?? null,
	getAuthUserEmailInfo: async (_ctx: unknown, authUserId: string) => {
		const email = authEmailByUserId.get(authUserId);
		if (!email) return null;
		return {
			email,
			emailVerified: !unverifiedUsers.has(authUserId),
			name: 'Invited Leader'
		};
	},
	getAuthUserIdByEmail: async (_ctx: unknown, email: string) => {
		for (const [authUserId, candidate] of authEmailByUserId) {
			if (candidate === email) return authUserId;
		}
		return null;
	}
}));

// Invite emails go through the resend module (via a scheduled action); stub it out so tests
// never hit the network.
vi.mock('./email/resend', () => ({
	sendEmail: vi.fn(async () => undefined)
}));

const seedRoles = async (t: ReturnType<typeof convexTest>) =>
	t.run(async (ctx) => {
		const now = Date.now();
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
	});

const seedProfile = async (
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

const seedAdmin = async (t: ReturnType<typeof convexTest>) => {
	const profileId = await seedProfile(t, 'admin-user');
	await t.run((ctx) =>
		ctx.runMutation(internal.profiles.setGlobalRole, { profileId, globalRole: 'admin' })
	);
	return profileId;
};

const asAdmin = (t: ReturnType<typeof convexTest>) => t.withIdentity({ subject: 'admin-user' });

const inviteLeader = (t: ReturnType<typeof convexTest>) =>
	asAdmin(t).mutation(api.clubLeaderInvites.createLeaderInvite, {
		email: 'leader@example.com',
		clubName: 'Braga Curiosity Club',
		clubDescription: 'Already running weekly sessions',
		clubLocation: 'Braga, Portugal',
		clubLocationLatitude: 41.55,
		clubLocationLongitude: -8.42
	});

describe('clubLeaderInvites.createLeaderInvite', () => {
	it('rejects a non-admin caller', async () => {
		const t = convexTest(schema, modules);
		await seedProfile(t, 'stranger-user');
		await expect(
			t.withIdentity({ subject: 'stranger-user' }).mutation(
				api.clubLeaderInvites.createLeaderInvite,
				{ email: 'new@example.com', clubName: 'A Club' }
			)
		).rejects.toThrow('Not authorized');
	});

	it('creates a pending invite carrying the club draft, with normalized email and expiry', async () => {
		const t = convexTest(schema, modules);
		await seedAdmin(t);

		const before = Date.now();
		await asAdmin(t).mutation(api.clubLeaderInvites.createLeaderInvite, {
			email: '  Leader@Example.COM ',
			clubName: '  Braga Curiosity Club  ',
			clubLocation: 'Braga, Portugal'
		});

		const invites = await asAdmin(t).query(api.clubLeaderInvites.listLeaderInvites, {});
		expect(invites).toHaveLength(1);
		expect(invites[0].email).toBe('leader@example.com');
		expect(invites[0].status).toBe('pending');
		expect(invites[0].clubName).toBe('Braga Curiosity Club');
		expect(invites[0].clubLocation).toBe('Braga, Portugal');
		expect(invites[0].expiresAt).toBeGreaterThanOrEqual(before + LEADER_INVITE_TTL_MS);
		expect(invites[0].invitedBy).toBe('admin-user');
	});

	it('rejects malformed emails, missing club names, and duplicate pending invites', async () => {
		const t = convexTest(schema, modules);
		await seedAdmin(t);

		await expect(
			asAdmin(t).mutation(api.clubLeaderInvites.createLeaderInvite, {
				email: 'not-an-email',
				clubName: 'A Club'
			})
		).rejects.toThrow('valid email');

		await expect(
			asAdmin(t).mutation(api.clubLeaderInvites.createLeaderInvite, {
				email: 'leader@example.com',
				clubName: '   '
			})
		).rejects.toThrow('Club name is required');

		await inviteLeader(t);
		await expect(
			asAdmin(t).mutation(api.clubLeaderInvites.createLeaderInvite, {
				email: 'Leader@Example.com',
				clubName: 'Another Club'
			})
		).rejects.toThrow('already a pending leader invite');
	});
});

describe('clubLeaderInvites.claimMyLeaderInvite', () => {
	it('founds the drafted club with the claimant as Guide and marks the invite accepted', async () => {
		const t = convexTest(schema, modules);
		await seedRoles(t);
		await seedAdmin(t);
		const leaderProfileId = await seedProfile(t, 'leader-user');
		await inviteLeader(t);

		const result = await t
			.withIdentity({ subject: 'leader-user' })
			.mutation(api.clubLeaderInvites.claimMyLeaderInvite, {});
		expect(result.status).toBe('claimed');
		if (result.status !== 'claimed') throw new Error('unreachable');

		const { club, membership, roleKey, profile, inviteRow } = await t.run(async (ctx) => {
			const club = await ctx.db.get(result.clubId);
			const membership = (await ctx.db.query('clubMembers').collect()).find(
				(row) => row.clubId === result.clubId && row.profileId === leaderProfileId
			);
			const role = membership ? await ctx.db.get(membership.roleId) : null;
			const profile = await ctx.db.get(leaderProfileId);
			const inviteRow = (await ctx.db.query('clubLeaderInvites').collect())[0];
			return { club, membership, roleKey: role?.key, profile, inviteRow };
		});

		expect(club?.name).toBe('Braga Curiosity Club');
		expect(club?.description).toBe('Already running weekly sessions');
		expect(club?.location).toBe('Braga, Portugal');
		expect(club?.clubCode).toHaveLength(6);
		expect(club?.discoverable).toBe(true);
		expect(club?.kind).toBe('curiosity');
		expect(club?.createdByProfileId).toBe(leaderProfileId);
		expect(membership?.leftAt).toBeUndefined();
		expect(roleKey).toBe('guide');
		expect(profile?.activeClubId).toBe(result.clubId);
		expect(profile?.firstLoginCompleted).toBe(true);
		expect(inviteRow.acceptedAt).toBeDefined();
		expect(inviteRow.acceptedByProfileId).toBe(leaderProfileId);
		expect(inviteRow.createdClubId).toBe(result.clubId);
	});

	it('does nothing without a pending invite, for unverified emails, expired, revoked, or suspended', async () => {
		const t = convexTest(schema, modules);
		await seedRoles(t);
		await seedAdmin(t);
		await seedProfile(t, 'stranger-user');

		// No invite at all.
		let result = await t
			.withIdentity({ subject: 'stranger-user' })
			.mutation(api.clubLeaderInvites.claimMyLeaderInvite, {});
		expect(result.status).toBe('no_invite');

		// Invite exists but the claimant's email is unverified.
		await seedProfile(t, 'unverified-user');
		await asAdmin(t).mutation(api.clubLeaderInvites.createLeaderInvite, {
			email: 'unverified@example.com',
			clubName: 'Unverified Club'
		});
		result = await t
			.withIdentity({ subject: 'unverified-user' })
			.mutation(api.clubLeaderInvites.claimMyLeaderInvite, {});
		expect(result.status).toBe('no_invite');

		// Expired invite.
		const leaderProfileId = await seedProfile(t, 'leader-user');
		await inviteLeader(t);
		await t.run(async (ctx) => {
			const invite = (await ctx.db.query('clubLeaderInvites').collect()).find(
				(row) => row.email === 'leader@example.com'
			);
			await ctx.db.patch(invite!._id, { expiresAt: Date.now() - 1 });
		});
		result = await t
			.withIdentity({ subject: 'leader-user' })
			.mutation(api.clubLeaderInvites.claimMyLeaderInvite, {});
		expect(result.status).toBe('no_invite');

		// Revoked invite.
		await inviteLeader(t);
		const invites = await asAdmin(t).query(api.clubLeaderInvites.listLeaderInvites, {});
		const pending = invites.find((invite) => invite.status === 'pending');
		await asAdmin(t).mutation(api.clubLeaderInvites.revokeLeaderInvite, {
			inviteId: pending!.inviteId
		});
		result = await t
			.withIdentity({ subject: 'leader-user' })
			.mutation(api.clubLeaderInvites.claimMyLeaderInvite, {});
		expect(result.status).toBe('no_invite');

		// Suspended profile with a fresh pending invite.
		await inviteLeader(t);
		await t.run((ctx) =>
			ctx.db.patch(leaderProfileId, { suspendedAt: Date.now(), suspendedReason: 'test' })
		);
		result = await t
			.withIdentity({ subject: 'leader-user' })
			.mutation(api.clubLeaderInvites.claimMyLeaderInvite, {});
		expect(result.status).toBe('no_invite');

		// No club got created along the way.
		const clubs = await t.run((ctx) => ctx.db.query('clubs').collect());
		expect(clubs).toHaveLength(0);
	});

	it('allows a fresh invite for the same email after one was accepted (e.g. a second club)', async () => {
		const t = convexTest(schema, modules);
		await seedRoles(t);
		await seedAdmin(t);
		await seedProfile(t, 'leader-user');
		await inviteLeader(t);
		await t
			.withIdentity({ subject: 'leader-user' })
			.mutation(api.clubLeaderInvites.claimMyLeaderInvite, {});

		await asAdmin(t).mutation(api.clubLeaderInvites.createLeaderInvite, {
			email: 'leader@example.com',
			clubName: 'Second Club'
		});
		const result = await t
			.withIdentity({ subject: 'leader-user' })
			.mutation(api.clubLeaderInvites.claimMyLeaderInvite, {});
		expect(result.status).toBe('claimed');

		// CoC group rows are clubs too (kind 'coc'), so filter to the real clubs.
		const clubs = await t.run((ctx) => ctx.db.query('clubs').collect());
		expect(
			clubs
				.filter((club) => club.kind === 'curiosity')
				.map((club) => club.name)
				.sort()
		).toEqual(['Braga Curiosity Club', 'Second Club']);
	});
});

describe('clubLeaderInvites.revokeLeaderInvite', () => {
	it('rejects non-admins and non-pending invites, and frees the email up again', async () => {
		const t = convexTest(schema, modules);
		await seedAdmin(t);
		await seedProfile(t, 'stranger-user');
		await inviteLeader(t);
		const [invite] = await asAdmin(t).query(api.clubLeaderInvites.listLeaderInvites, {});

		await expect(
			t
				.withIdentity({ subject: 'stranger-user' })
				.mutation(api.clubLeaderInvites.revokeLeaderInvite, { inviteId: invite.inviteId })
		).rejects.toThrow('Not authorized');

		await asAdmin(t).mutation(api.clubLeaderInvites.revokeLeaderInvite, {
			inviteId: invite.inviteId
		});
		await expect(
			asAdmin(t).mutation(api.clubLeaderInvites.revokeLeaderInvite, {
				inviteId: invite.inviteId
			})
		).rejects.toThrow('Only pending invites');

		// A revoked invite frees the email up for a fresh invite.
		await inviteLeader(t);
	});
});
