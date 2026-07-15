import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import schema from './schema';
import { isGlobalAdmin, requireGlobalAdmin } from './permissions';

const modules = import.meta.glob('./**/*.ts');

describe('permissions.isGlobalAdmin / requireGlobalAdmin', () => {
	it('isGlobalAdmin is false for a profile with no globalRole', async () => {
		const t = convexTest(schema, modules);
		await t.run(async (ctx) => {
			await ctx.db.insert('profiles', {
				authUserId: 'regular-user',
				isVerified: true,
				firstLoginCompleted: true,
				updatedAt: Date.now()
			});
		});

		const result = await t.run((ctx) => isGlobalAdmin(ctx, 'regular-user'));
		expect(result).toBe(false);
	});

	it('isGlobalAdmin is false when there is no profile at all', async () => {
		const t = convexTest(schema, modules);
		const result = await t.run((ctx) => isGlobalAdmin(ctx, 'nonexistent-user'));
		expect(result).toBe(false);
	});

	it('isGlobalAdmin is true once globalRole is admin', async () => {
		const t = convexTest(schema, modules);
		await t.run(async (ctx) => {
			await ctx.db.insert('profiles', {
				authUserId: 'admin-user',
				isVerified: true,
				firstLoginCompleted: true,
				globalRole: 'admin',
				updatedAt: Date.now()
			});
		});

		const result = await t.run((ctx) => isGlobalAdmin(ctx, 'admin-user'));
		expect(result).toBe(true);
	});

	it('requireGlobalAdmin rejects an anonymous caller', async () => {
		const t = convexTest(schema, modules);
		await expect(t.run(async (ctx) => requireGlobalAdmin(ctx))).rejects.toThrow('Unauthenticated');
	});

	it('requireGlobalAdmin rejects an authenticated non-admin', async () => {
		const t = convexTest(schema, modules);
		await t.run(async (ctx) => {
			await ctx.db.insert('profiles', {
				authUserId: 'regular-user',
				isVerified: true,
				firstLoginCompleted: true,
				updatedAt: Date.now()
			});
		});

		await expect(
			t.withIdentity({ subject: 'regular-user' }).run(async (ctx) => requireGlobalAdmin(ctx))
		).rejects.toThrow('Not authorized');
	});

	it('requireGlobalAdmin resolves for an admin', async () => {
		const t = convexTest(schema, modules);
		await t.run(async (ctx) => {
			await ctx.db.insert('profiles', {
				authUserId: 'admin-user',
				isVerified: true,
				firstLoginCompleted: true,
				globalRole: 'admin',
				updatedAt: Date.now()
			});
		});

		await expect(
			t.withIdentity({ subject: 'admin-user' }).run(async (ctx) => requireGlobalAdmin(ctx))
		).resolves.toBeDefined();
	});
});
