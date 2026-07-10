/// <reference types="vite/client" />

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

const seedBuildingBlock = async (t: ReturnType<typeof convexTest>, name: string) =>
	t.run(async (ctx) =>
		ctx.db.insert('buildingBlocks', {
			name,
			createdAt: Date.now()
		})
	);

describe('admin booklet activity endpoints', () => {
	it('adminListActivities rejects an anonymous caller', async () => {
		const t = convexTest(schema, modules);
		await expect(t.query(api.booklet.adminListActivities, {})).rejects.toThrow();
	});

	it('adminListActivities rejects an authenticated non-admin', async () => {
		const t = convexTest(schema, modules);
		await seedProfile(t, 'regular-user');
		await expect(
			t.withIdentity({ subject: 'regular-user' }).query(api.booklet.adminListActivities, {})
		).rejects.toThrow('Not authorized');
	});

	it('adminCreateActivity rejects a non-admin caller', async () => {
		const t = convexTest(schema, modules);
		await seedProfile(t, 'regular-user');
		await expect(
			t.withIdentity({ subject: 'regular-user' }).mutation(api.booklet.adminCreateActivity, {
				name: 'Test Activity',
				content: 'Do the thing',
				minutes: 30,
				buildingBlockIds: []
			})
		).rejects.toThrow('Not authorized');
	});

	it('adminCreateActivity creates an activity with building blocks for an admin caller', async () => {
		const t = convexTest(schema, modules);
		const adminProfileId = await seedProfile(t, 'admin-user');
		await makeAdmin(t, adminProfileId);
		const blockId = await seedBuildingBlock(t, 'Get curious');

		const asAdmin = t.withIdentity({ subject: 'admin-user' });
		const activityId = await asAdmin.mutation(api.booklet.adminCreateActivity, {
			name: 'Test Activity',
			content: 'Do the thing',
			minutes: 30,
			buildingBlockIds: [blockId]
		});
		expect(activityId).toBeTruthy();

		const activities = await asAdmin.query(api.booklet.adminListActivities, {});
		expect(activities).toHaveLength(1);
		expect(activities[0].name).toBe('Test Activity');
		expect(activities[0].buildingBlockIds).toEqual([blockId]);
		expect(activities[0].buildingBlockNames).toEqual(['Get curious']);
	});

	it('adminUpdateActivity rejects a non-admin caller', async () => {
		const t = convexTest(schema, modules);
		const adminProfileId = await seedProfile(t, 'admin-user');
		await makeAdmin(t, adminProfileId);
		await seedProfile(t, 'regular-user');

		const asAdmin = t.withIdentity({ subject: 'admin-user' });
		const activityId = await asAdmin.mutation(api.booklet.adminCreateActivity, {
			name: 'Test Activity',
			buildingBlockIds: []
		});

		await expect(
			t.withIdentity({ subject: 'regular-user' }).mutation(api.booklet.adminUpdateActivity, {
				activityId,
				name: 'Renamed',
				buildingBlockIds: []
			})
		).rejects.toThrow('Not authorized');
	});

	it('adminUpdateActivity replaces building-block links for an admin caller', async () => {
		const t = convexTest(schema, modules);
		const adminProfileId = await seedProfile(t, 'admin-user');
		await makeAdmin(t, adminProfileId);
		const blockA = await seedBuildingBlock(t, 'Get curious');
		const blockB = await seedBuildingBlock(t, 'Team building');

		const asAdmin = t.withIdentity({ subject: 'admin-user' });
		const activityId = await asAdmin.mutation(api.booklet.adminCreateActivity, {
			name: 'Test Activity',
			minutes: 15,
			buildingBlockIds: [blockA]
		});

		await asAdmin.mutation(api.booklet.adminUpdateActivity, {
			activityId,
			name: 'Renamed Activity',
			minutes: 45,
			buildingBlockIds: [blockB]
		});

		const activities = await asAdmin.query(api.booklet.adminListActivities, {});
		expect(activities).toHaveLength(1);
		expect(activities[0].name).toBe('Renamed Activity');
		expect(activities[0].minutes).toBe(45);
		expect(activities[0].buildingBlockIds).toEqual([blockB]);

		const remainingLinks = await t.run((ctx) =>
			ctx.db
				.query('bookletActivityBuildingBlocks')
				.withIndex('by_activity', (q) => q.eq('activityId', activityId))
				.collect()
		);
		expect(remainingLinks).toHaveLength(1);
		expect(remainingLinks[0].buildingBlockId).toBe(blockB);
	});

	it('adminDeleteActivity rejects a non-admin caller', async () => {
		const t = convexTest(schema, modules);
		const adminProfileId = await seedProfile(t, 'admin-user');
		await makeAdmin(t, adminProfileId);
		await seedProfile(t, 'regular-user');

		const asAdmin = t.withIdentity({ subject: 'admin-user' });
		const activityId = await asAdmin.mutation(api.booklet.adminCreateActivity, {
			name: 'Test Activity',
			buildingBlockIds: []
		});

		await expect(
			t
				.withIdentity({ subject: 'regular-user' })
				.mutation(api.booklet.adminDeleteActivity, { activityId })
		).rejects.toThrow('Not authorized');
	});

	it('adminDeleteActivity removes the activity and its link rows, but leaves session copies intact', async () => {
		const t = convexTest(schema, modules);
		const adminProfileId = await seedProfile(t, 'admin-user');
		await makeAdmin(t, adminProfileId);
		const blockId = await seedBuildingBlock(t, 'Get curious');

		const asAdmin = t.withIdentity({ subject: 'admin-user' });
		const activityId = await asAdmin.mutation(api.booklet.adminCreateActivity, {
			name: 'Test Activity',
			content: 'Do the thing',
			minutes: 20,
			buildingBlockIds: [blockId]
		});

		// Simulate a club member adding this activity to a session before it gets deleted.
		const { clubId, sessionId } = await t.run(async (ctx) => {
			const now = Date.now();
			const roleId = await ctx.db.insert('clubRoles', {
				key: 'guide',
				permissions: ['session_activity:create'],
				name: 'Guide',
				order: 0,
				createdAt: now
			});
			const clubId = await ctx.db.insert('clubs', {
				name: 'Fixture club',
				discoverable: false,
				createdByProfileId: adminProfileId,
				createdAt: now,
				updatedAt: now
			});
			await ctx.db.insert('clubMembers', {
				clubId,
				profileId: adminProfileId,
				roleId,
				createdAt: now
			});
			const sessionId = await ctx.db.insert('sessions', {
				clubId,
				startTime: now,
				endTime: now + 60 * 60 * 1000,
				createdByProfileId: adminProfileId,
				createdAt: now,
				updatedAt: now
			});
			return { clubId, sessionId };
		});

		const sessionActivity = await asAdmin.mutation(api.booklet.addToSession, {
			bookletActivityId: activityId,
			sessionId
		});

		await asAdmin.mutation(api.booklet.adminDeleteActivity, { activityId });

		const activities = await asAdmin.query(api.booklet.adminListActivities, {});
		expect(activities).toHaveLength(0);

		const remainingLinks = await t.run((ctx) =>
			ctx.db
				.query('bookletActivityBuildingBlocks')
				.withIndex('by_activity', (q) => q.eq('activityId', activityId))
				.collect()
		);
		expect(remainingLinks).toHaveLength(0);

		// The session's own copy is untouched by the deletion (fork, not reference).
		const stillThere = await t.run((ctx) => ctx.db.get(sessionActivity!._id));
		expect(stillThere?.name).toBe('Test Activity');
		expect(stillThere?.content).toBe('Do the thing');
		void clubId;
	});

	it('adminListBuildingBlocks rejects a non-admin caller', async () => {
		const t = convexTest(schema, modules);
		await seedProfile(t, 'regular-user');
		await expect(
			t.withIdentity({ subject: 'regular-user' }).query(api.booklet.adminListBuildingBlocks, {})
		).rejects.toThrow('Not authorized');
	});

	it('adminListBuildingBlocks returns seeded building blocks for an admin caller', async () => {
		const t = convexTest(schema, modules);
		const adminProfileId = await seedProfile(t, 'admin-user');
		await makeAdmin(t, adminProfileId);
		await seedBuildingBlock(t, 'Get curious');
		await seedBuildingBlock(t, 'Team building');

		const blocks = await t
			.withIdentity({ subject: 'admin-user' })
			.query(api.booklet.adminListBuildingBlocks, {});
		expect(blocks).toHaveLength(2);
	});
});

describe('member booklet queries (regression, unaffected by admin endpoints)', () => {
	it('listActivities still requires authentication and returns activities with block names', async () => {
		const t = convexTest(schema, modules);
		const profileId = await seedProfile(t, 'member-user');
		const blockId = await seedBuildingBlock(t, 'Get curious');

		await t.run(async (ctx) => {
			const now = Date.now();
			const activityId = await ctx.db.insert('bookletActivities', {
				name: 'Member Activity',
				content: 'Content',
				minutes: 10,
				createdByProfileId: profileId,
				createdAt: now,
				updatedAt: now
			});
			await ctx.db.insert('bookletActivityBuildingBlocks', {
				activityId,
				buildingBlockId: blockId
			});
		});

		await expect(t.query(api.booklet.listActivities, {})).rejects.toThrow();

		const activities = await t
			.withIdentity({ subject: 'member-user' })
			.query(api.booklet.listActivities, {});
		expect(activities).toHaveLength(1);
		expect(activities[0].name).toBe('Member Activity');
		expect(activities[0].buildingBlockNames).toEqual(['Get curious']);
	});
});
