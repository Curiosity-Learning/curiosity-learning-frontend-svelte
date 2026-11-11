import { convexTest } from 'convex-test';
import { describe, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

// The betterAuth component is not available in convex-test, so the auth-email lookups are mocked
// with a fixed authUserId <-> email map (same pattern as parentAccounts.spec.ts).
const { emails } = vi.hoisted(() => ({
	emails: new Map<string, string>([
		['admin-user', 'admin@example.com'],
		['child-user', 'child-user@children.curiosity.local'],
		['parent-user', 'parent@example.com']
	])
}));

vi.mock('./authEmail', () => ({
	getAuthUserEmailInfo: async (_ctx: unknown, authUserId: string) => {
		const email = emails.get(authUserId);
		return email ? { email, emailVerified: true, name: null } : null;
	},
	getAuthUserIdByEmail: async (_ctx: unknown, email: string) =>
		[...emails.entries()].find(([, value]) => value === email)?.[0] ?? null
}));

const seedProfile = (
	t: ReturnType<typeof convexTest>,
	authUserId: string,
	fields: { firstName?: string; lastName?: string } = {}
): Promise<Id<'profiles'>> =>
	t.run((ctx) =>
		ctx.db.insert('profiles', {
			authUserId,
			username: authUserId,
			...fields,
			isVerified: true,
			firstLoginCompleted: true,
			updatedAt: Date.now()
		})
	);

const seedFamily = async () => {
	const t = convexTest(schema, modules);
	const adminId = await seedProfile(t, 'admin-user');
	await t.run((ctx) =>
		ctx.runMutation(internal.profiles.setGlobalRole, { profileId: adminId, globalRole: 'admin' })
	);
	const childId = await seedProfile(t, 'child-user', { firstName: 'Ada', lastName: 'Lovelace' });
	const parentId = await seedProfile(t, 'parent-user', { firstName: 'Byron' });
	await t.run(async (ctx) => {
		const now = Date.now();
		await ctx.db.insert('parentChildConsents', {
			childProfileId: childId,
			parentProfileId: parentId,
			parentEmail: 'parent@example.com',
			status: 'approved',
			token: 'token',
			approvedAt: now,
			createdAt: now,
			updatedAt: now
		});
		await ctx.db.insert('parentLinks', {
			parentProfileId: parentId,
			childProfileId: childId,
			createdAt: now
		});
	});
	return { t, admin: t.withIdentity({ subject: 'admin-user' }), childId, parentId };
};

describe('adminUsers', () => {
	it('rejects non-admin callers', async () => {
		const { t, childId } = await seedFamily();
		const member = t.withIdentity({ subject: 'child-user' });
		await expect(member.query(api.adminUsers.searchUsers, { search: 'ada' })).rejects.toThrow(
			'Not authorized'
		);
		await expect(
			member.query(api.adminUsers.getUserDetails, { profileId: childId })
		).rejects.toThrow('Not authorized');
	});

	it('rejects signed-out callers', async () => {
		const { t, childId } = await seedFamily();
		await expect(t.query(api.adminUsers.searchUsers, { search: 'ada' })).rejects.toThrow(
			'Unauthenticated'
		);
		await expect(t.query(api.adminUsers.getUserDetails, { profileId: childId })).rejects.toThrow(
			'Unauthenticated'
		);
	});

	it('rejects a suspended admin', async () => {
		const { t, admin, childId } = await seedFamily();
		await t.run(async (ctx) => {
			const profile = await ctx.db
				.query('profiles')
				.withIndex('by_auth_user_id', (q) => q.eq('authUserId', 'admin-user'))
				.unique();
			await ctx.db.patch(profile!._id, { suspendedAt: Date.now(), suspendedReason: 'test' });
		});
		await expect(admin.query(api.adminUsers.searchUsers, { search: 'ada' })).rejects.toThrow(
			'Account suspended'
		);
		await expect(
			admin.query(api.adminUsers.getUserDetails, { profileId: childId })
		).rejects.toThrow('Account suspended');
	});

	it('finds users by username, name and email, with their email', async () => {
		const { admin, childId, parentId } = await seedFamily();

		const byUsername = await admin.query(api.adminUsers.searchUsers, { search: 'child' });
		expect(byUsername.map((user) => user.profileId)).toEqual([childId]);
		expect(byUsername[0]).toMatchObject({ email: null, isChildAccount: true });

		const byName = await admin.query(api.adminUsers.searchUsers, { search: 'ada love' });
		expect(byName.map((user) => user.profileId)).toEqual([childId]);

		// A parent's address finds the parent and the child whose consent names it.
		const byParentEmail = await admin.query(api.adminUsers.searchUsers, {
			search: ' Parent@Example.com '
		});
		expect(byParentEmail.map((user) => user.profileId).sort()).toEqual([childId, parentId].sort());
	});

	it('returns contact details with the parent consent and linked parent', async () => {
		const { admin, childId, parentId } = await seedFamily();

		const details = await admin.query(api.adminUsers.getUserDetails, { profileId: childId });
		expect(details).toMatchObject({
			email: null,
			isChildAccount: true,
			parentConsent: { parentEmail: 'parent@example.com', status: 'approved' },
			parents: [{ profileId: parentId, email: 'parent@example.com' }],
			children: []
		});

		const parentDetails = await admin.query(api.adminUsers.getUserDetails, {
			profileId: parentId
		});
		expect(parentDetails?.children).toMatchObject([{ profileId: childId }]);
	});
});
