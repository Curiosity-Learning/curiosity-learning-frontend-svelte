import { convexTest } from 'convex-test';
import { describe, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';
import { INVITE_TTL_MS } from './adminInvites';

const modules = import.meta.glob('./**/*.ts');

// The betterAuth component is not available in convex-test, so the auth-email lookup module is
// mocked with fixed maps, same pattern as parentAccounts.spec.ts. `unverifiedUsers` lets tests
// exercise the emailVerified gate in claimAdminInvite.
const { authEmailByUserId, unverifiedUsers } = vi.hoisted(() => ({
	authEmailByUserId: new Map<string, string>([
		['admin-user', 'admin@example.com'],
		['second-admin-user', 'second-admin@example.com'],
		['invited-user', 'invited@example.com'],
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
			name: 'Invited Person'
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

const makeAdmin = async (t: ReturnType<typeof convexTest>, profileId: Id<'profiles'>) =>
	t.run((ctx) =>
		ctx.runMutation(internal.profiles.setGlobalRole, { profileId, globalRole: 'admin' })
	);

const seedAdmin = async (t: ReturnType<typeof convexTest>, authUserId = 'admin-user') => {
	const profileId = await seedProfile(t, authUserId);
	await makeAdmin(t, profileId);
	return profileId;
};

const asAdmin = (t: ReturnType<typeof convexTest>) => t.withIdentity({ subject: 'admin-user' });

describe('adminInvites.createInvite', () => {
	it('rejects a non-admin caller', async () => {
		const t = convexTest(schema, modules);
		await seedProfile(t, 'stranger-user');
		await expect(
			t
				.withIdentity({ subject: 'stranger-user' })
				.mutation(api.adminInvites.createInvite, { email: 'new@example.com' })
		).rejects.toThrow('Not authorized');
	});

	it('creates a pending invite with normalized email and expiry', async () => {
		const t = convexTest(schema, modules);
		const adminProfileId = await seedAdmin(t);

		const before = Date.now();
		await asAdmin(t).mutation(api.adminInvites.createInvite, {
			email: '  New.Admin@Example.COM '
		});

		const invites = await asAdmin(t).query(api.adminInvites.listInvites, {});
		expect(invites).toHaveLength(1);
		expect(invites[0].email).toBe('new.admin@example.com');
		expect(invites[0].status).toBe('pending');
		expect(invites[0].expiresAt).toBeGreaterThanOrEqual(before + INVITE_TTL_MS);
		expect(invites[0].invitedBy).toBe('admin-user');

		// The inviter is recorded on the row itself, not just the display name.
		const row = await t.run(async (ctx) => (await ctx.db.query('adminInvites').collect())[0]);
		expect(row.invitedByProfileId).toBe(adminProfileId);
	});

	it('rejects malformed emails, duplicate pending invites, and existing admins', async () => {
		const t = convexTest(schema, modules);
		await seedAdmin(t);
		const secondAdminProfileId = await seedProfile(t, 'second-admin-user');
		await makeAdmin(t, secondAdminProfileId);

		await expect(
			asAdmin(t).mutation(api.adminInvites.createInvite, { email: 'not-an-email' })
		).rejects.toThrow('valid email');

		await asAdmin(t).mutation(api.adminInvites.createInvite, { email: 'new@example.com' });
		await expect(
			asAdmin(t).mutation(api.adminInvites.createInvite, { email: 'New@Example.com' })
		).rejects.toThrow('already a pending invite');

		await expect(
			asAdmin(t).mutation(api.adminInvites.createInvite, { email: 'second-admin@example.com' })
		).rejects.toThrow('already an admin');
	});
});

describe('adminInvites.claimAdminInvite', () => {
	it('grants admin to a verified user with a pending invite and marks the invite accepted', async () => {
		const t = convexTest(schema, modules);
		await seedAdmin(t);
		await seedProfile(t, 'invited-user');
		await asAdmin(t).mutation(api.adminInvites.createInvite, { email: 'invited@example.com' });

		const result = await t
			.withIdentity({ subject: 'invited-user' })
			.mutation(api.adminInvites.claimAdminInvite, {});
		expect(result.status).toBe('granted');

		const admins = await asAdmin(t).query(api.adminInvites.listAdmins, {});
		expect(admins.map((admin) => admin.email).sort()).toEqual([
			'admin@example.com',
			'invited@example.com'
		]);

		const invites = await asAdmin(t).query(api.adminInvites.listInvites, {});
		expect(invites[0].status).toBe('accepted');
	});

	it('creates a minimal profile when the claimant has none yet', async () => {
		const t = convexTest(schema, modules);
		await seedAdmin(t);
		await asAdmin(t).mutation(api.adminInvites.createInvite, { email: 'invited@example.com' });

		const result = await t
			.withIdentity({ subject: 'invited-user' })
			.mutation(api.adminInvites.claimAdminInvite, {});
		expect(result.status).toBe('granted');

		const profile = await t.run(async (ctx) =>
			(await ctx.db.query('profiles').collect()).find((p) => p.authUserId === 'invited-user')
		);
		expect(profile?.globalRole).toBe('admin');
		expect(profile?.firstName).toBe('Invited');
		expect(profile?.lastName).toBe('Person');
	});

	it('does nothing without a pending invite, for unverified emails, expired and revoked invites', async () => {
		const t = convexTest(schema, modules);
		await seedAdmin(t);

		// No invite at all.
		let result = await t
			.withIdentity({ subject: 'stranger-user' })
			.mutation(api.adminInvites.claimAdminInvite, {});
		expect(result.status).toBe('no_invite');

		// Invite exists but the claimant's email is unverified.
		await asAdmin(t).mutation(api.adminInvites.createInvite, { email: 'unverified@example.com' });
		result = await t
			.withIdentity({ subject: 'unverified-user' })
			.mutation(api.adminInvites.claimAdminInvite, {});
		expect(result.status).toBe('no_invite');

		// Expired invite.
		await asAdmin(t).mutation(api.adminInvites.createInvite, { email: 'invited@example.com' });
		await t.run(async (ctx) => {
			const invite = (await ctx.db.query('adminInvites').collect()).find(
				(row) => row.email === 'invited@example.com'
			);
			await ctx.db.patch(invite!._id, { expiresAt: Date.now() - 1 });
		});
		result = await t
			.withIdentity({ subject: 'invited-user' })
			.mutation(api.adminInvites.claimAdminInvite, {});
		expect(result.status).toBe('no_invite');

		// Revoked invite (fresh one, then revoked).
		await asAdmin(t).mutation(api.adminInvites.createInvite, { email: 'stranger@example.com' });
		const invites = await asAdmin(t).query(api.adminInvites.listInvites, {});
		const pending = invites.find((invite) => invite.status === 'pending');
		await asAdmin(t).mutation(api.adminInvites.revokeInvite, { inviteId: pending!.inviteId });
		result = await t
			.withIdentity({ subject: 'stranger-user' })
			.mutation(api.adminInvites.claimAdminInvite, {});
		expect(result.status).toBe('no_invite');

		// Nobody got granted along the way.
		const admins = await asAdmin(t).query(api.adminInvites.listAdmins, {});
		expect(admins).toHaveLength(1);
	});

	it('is a no-op for an existing admin', async () => {
		const t = convexTest(schema, modules);
		await seedAdmin(t);
		const result = await asAdmin(t).mutation(api.adminInvites.claimAdminInvite, {});
		expect(result.status).toBe('already_admin');
	});
});

describe('adminInvites.revokeInvite', () => {
	it('rejects non-admins and non-pending invites', async () => {
		const t = convexTest(schema, modules);
		await seedAdmin(t);
		await seedProfile(t, 'stranger-user');
		await asAdmin(t).mutation(api.adminInvites.createInvite, { email: 'invited@example.com' });
		const [invite] = await asAdmin(t).query(api.adminInvites.listInvites, {});

		await expect(
			t
				.withIdentity({ subject: 'stranger-user' })
				.mutation(api.adminInvites.revokeInvite, { inviteId: invite.inviteId })
		).rejects.toThrow('Not authorized');

		await asAdmin(t).mutation(api.adminInvites.revokeInvite, { inviteId: invite.inviteId });
		await expect(
			asAdmin(t).mutation(api.adminInvites.revokeInvite, { inviteId: invite.inviteId })
		).rejects.toThrow('Only pending invites');

		// A revoked invite frees the email up for a fresh invite.
		await asAdmin(t).mutation(api.adminInvites.createInvite, { email: 'invited@example.com' });
	});
});

describe('adminInvites.removeAdmin', () => {
	it('demotes another admin but never the caller', async () => {
		const t = convexTest(schema, modules);
		const adminProfileId = await seedAdmin(t);
		const secondProfileId = await seedProfile(t, 'second-admin-user');
		await makeAdmin(t, secondProfileId);

		await expect(
			asAdmin(t).mutation(api.adminInvites.removeAdmin, { profileId: adminProfileId })
		).rejects.toThrow('your own admin access');

		await asAdmin(t).mutation(api.adminInvites.removeAdmin, { profileId: secondProfileId });
		const admins = await asAdmin(t).query(api.adminInvites.listAdmins, {});
		expect(admins).toHaveLength(1);
		expect(admins[0].profileId).toBe(adminProfileId);

		await expect(
			asAdmin(t).mutation(api.adminInvites.removeAdmin, { profileId: secondProfileId })
		).rejects.toThrow('not an admin');
	});
});

describe('adminInvites.seedInvite', () => {
	it('creates a claimable bootstrap invite with no inviter', async () => {
		const t = convexTest(schema, modules);
		await t.run((ctx) =>
			ctx.runMutation(internal.adminInvites.seedInvite, { email: 'Invited@Example.com' })
		);

		const result = await t
			.withIdentity({ subject: 'invited-user' })
			.mutation(api.adminInvites.claimAdminInvite, {});
		expect(result.status).toBe('granted');

		const invites = await t
			.withIdentity({ subject: 'invited-user' })
			.query(api.adminInvites.listInvites, {});
		expect(invites[0].status).toBe('accepted');
		expect(invites[0].invitedBy).toBeNull();
	});
});
