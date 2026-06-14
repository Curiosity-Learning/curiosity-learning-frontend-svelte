import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

const seedSessionFixture = async () => {
	const t = convexTest(schema, modules);
	const ids = await t.run(async (ctx) => {
		const now = Date.now();
		const roleId = await ctx.db.insert('clubRoles', {
			name: 'Guide',
			permissions: ['session_activity:update'],
			order: 0,
			createdAt: now
		});
		const profileId = await ctx.db.insert('profiles', {
			userId: 'guide-user',
			isVerified: true,
			firstLoginCompleted: true,
			updatedAt: now
		});
		const firstClubId = await ctx.db.insert('clubs', {
			name: 'First club',
			createdByUserId: 'guide-user',
			createdAt: now,
			updatedAt: now
		});
		const secondClubId = await ctx.db.insert('clubs', {
			name: 'Second club',
			createdByUserId: 'guide-user',
			createdAt: now,
			updatedAt: now
		});
		await ctx.db.insert('clubMembers', {
			clubId: firstClubId,
			userId: 'guide-user',
			roleId,
			createdAt: now
		});
		const firstSessionId = await ctx.db.insert('sessions', {
			clubId: firstClubId,
			startTime: now,
			endTime: now + 60_000,
			createdByUserId: 'guide-user',
			createdAt: now,
			updatedAt: now
		});
		const secondSessionId = await ctx.db.insert('sessions', {
			clubId: secondClubId,
			startTime: now,
			endTime: now + 60_000,
			createdByUserId: 'guide-user',
			createdAt: now,
			updatedAt: now
		});
		const secondSessionActivityId = await ctx.db.insert('sessionActivities', {
			sessionId: secondSessionId,
			name: 'Protected activity',
			createdByUserId: 'guide-user',
			createdAt: now,
			updatedAt: now
		});

		return { profileId, firstSessionId, secondSessionActivityId };
	});

	return {
		t: t.withIdentity({ subject: 'guide-user' }),
		...ids
	};
};

describe('relational integrity', () => {
	it('rejects updating an activity through a different session', async () => {
		const { t, firstSessionId, secondSessionActivityId } = await seedSessionFixture();

		await expect(
			t.mutation(api.sessions.upsertActivity, {
				sessionId: firstSessionId,
				activityId: secondSessionActivityId,
				name: 'Unauthorized edit'
			})
		).rejects.toThrow('Activity does not belong to this session');
	});

	it('rejects reordering activities from a different session', async () => {
		const { t, firstSessionId, secondSessionActivityId } = await seedSessionFixture();

		await expect(
			t.mutation(api.sessions.reorderActivities, {
				sessionId: firstSessionId,
				activityIds: [secondSessionActivityId]
			})
		).rejects.toThrow('Activity does not belong to this session');

		const activity = await t.run((ctx) => ctx.db.get(secondSessionActivityId));
		expect(activity?.order).toBeUndefined();
	});
});
