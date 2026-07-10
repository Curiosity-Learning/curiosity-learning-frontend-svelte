import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

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

describe('admin.getOverviewCounts', () => {
	it('rejects an anonymous caller', async () => {
		const t = convexTest(schema, modules);
		await expect(t.query(api.admin.getOverviewCounts, {})).rejects.toThrow();
	});

	it('rejects an authenticated non-admin', async () => {
		const t = convexTest(schema, modules);
		await seedProfile(t, 'regular-user');

		await expect(
			t.withIdentity({ subject: 'regular-user' }).query(api.admin.getOverviewCounts, {})
		).rejects.toThrow('Not authorized');
	});

	it('returns counts for an admin caller', async () => {
		const t = convexTest(schema, modules);
		const adminProfileId = await seedProfile(t, 'admin-user');
		await makeAdmin(t, adminProfileId);
		await seedProfile(t, 'other-user');

		await t.run(async (ctx) => {
			const now = Date.now();
			await ctx.db.insert('clubs', {
				name: 'Fixture club',
				discoverable: false,
				createdByProfileId: adminProfileId,
				createdAt: now,
				updatedAt: now
			});
			await ctx.db.insert('reports', {
				reporterProfileId: adminProfileId,
				category: 'other',
				targetType: 'club',
				targetId: 'fixture',
				status: 'open',
				createdAt: now
			});
		});

		const result = await t
			.withIdentity({ subject: 'admin-user' })
			.query(api.admin.getOverviewCounts, {});

		expect(result.clubCount).toBe(1);
		expect(result.profileCount).toBe(2);
		expect(result.openReportCount).toBe(1);
	});
});
