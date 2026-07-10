/// <reference types="vite/client" />

import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

const DAY = 24 * 60 * 60 * 1000;

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

const validSeasonArgs = (now: number) => ({
	name: 'Admin Season',
	startDate: now,
	endDate: now + 10 * DAY,
	reviewWindowOpen: now - 10 * DAY,
	reviewWindowClose: now - 5 * DAY,
	feedbackDeadline: now + 12 * DAY
});

describe('seasons', () => {
	it('createSeason rejects endDate before startDate', async () => {
		const t = convexTest(schema, modules);
		await expect(
			t.mutation(internal.seasons.createSeason, {
				name: 'Bad Season',
				startDate: 1000,
				endDate: 500,
				reviewWindowOpen: 0,
				reviewWindowClose: 100,
				feedbackDeadline: 2000
			})
		).rejects.toThrow();
	});

	it('createSeason rejects reviewWindowClose before reviewWindowOpen', async () => {
		const t = convexTest(schema, modules);
		await expect(
			t.mutation(internal.seasons.createSeason, {
				name: 'Bad Season',
				startDate: 1000,
				endDate: 2000,
				reviewWindowOpen: 500,
				reviewWindowClose: 100,
				feedbackDeadline: 2000
			})
		).rejects.toThrow();
	});

	it('getCurrentSeason returns the season whose window contains now', async () => {
		const t = convexTest(schema, modules);
		const now = Date.now();
		await t.mutation(internal.seasons.createSeason, {
			name: 'Past Season',
			startDate: now - 10 * DAY,
			endDate: now - 5 * DAY,
			reviewWindowOpen: now - 20 * DAY,
			reviewWindowClose: now - 15 * DAY,
			feedbackDeadline: now - 4 * DAY
		});
		await t.mutation(internal.seasons.createSeason, {
			name: 'Current Season',
			startDate: now - 1 * DAY,
			endDate: now + 5 * DAY,
			reviewWindowOpen: now - 10 * DAY,
			reviewWindowClose: now - 2 * DAY,
			feedbackDeadline: now + 6 * DAY
		});

		const asUser = t.withIdentity({ subject: 'someone' });
		const current = await asUser.query(api.seasons.getCurrentSeason, {});
		expect(current?.name).toBe('Current Season');
	});

	it('getCurrentSeason falls back to the closest upcoming season when none is active', async () => {
		const t = convexTest(schema, modules);
		const now = Date.now();
		await t.mutation(internal.seasons.createSeason, {
			name: 'Far Future',
			startDate: now + 30 * DAY,
			endDate: now + 60 * DAY,
			reviewWindowOpen: now + 10 * DAY,
			reviewWindowClose: now + 20 * DAY,
			feedbackDeadline: now + 65 * DAY
		});
		await t.mutation(internal.seasons.createSeason, {
			name: 'Near Future',
			startDate: now + 5 * DAY,
			endDate: now + 10 * DAY,
			reviewWindowOpen: now + 1 * DAY,
			reviewWindowClose: now + 2 * DAY,
			feedbackDeadline: now + 12 * DAY
		});

		const asUser = t.withIdentity({ subject: 'someone' });
		const current = await asUser.query(api.seasons.getCurrentSeason, {});
		expect(current?.name).toBe('Near Future');
	});

	it('getCurrentSeason returns null when there are no seasons', async () => {
		const t = convexTest(schema, modules);
		const asUser = t.withIdentity({ subject: 'someone' });
		const current = await asUser.query(api.seasons.getCurrentSeason, {});
		expect(current).toBeNull();
	});

	it('listSeasons requires authentication', async () => {
		const t = convexTest(schema, modules);
		await expect(t.query(api.seasons.listSeasons, {})).rejects.toThrow();
	});

	it('updateSeason patches fields and rejects invalid ranges', async () => {
		const t = convexTest(schema, modules);
		const now = Date.now();
		const seasonId = await t.mutation(internal.seasons.createSeason, {
			name: 'Editable Season',
			startDate: now,
			endDate: now + 10 * DAY,
			reviewWindowOpen: now - 10 * DAY,
			reviewWindowClose: now - 5 * DAY,
			feedbackDeadline: now + 12 * DAY
		});

		await t.mutation(internal.seasons.updateSeason, {
			seasonId,
			name: 'Renamed Season',
			startDate: now,
			endDate: now + 20 * DAY,
			reviewWindowOpen: now - 10 * DAY,
			reviewWindowClose: now - 5 * DAY,
			feedbackDeadline: now + 22 * DAY
		});

		const asUser = t.withIdentity({ subject: 'someone' });
		const seasons = await asUser.query(api.seasons.listSeasons, {});
		expect(seasons).toHaveLength(1);
		expect(seasons[0].name).toBe('Renamed Season');
		expect(seasons[0].endDate).toBe(now + 20 * DAY);

		await expect(
			t.mutation(internal.seasons.updateSeason, {
				seasonId,
				name: 'Renamed Season',
				startDate: now + 100,
				endDate: now,
				reviewWindowOpen: now - 10 * DAY,
				reviewWindowClose: now - 5 * DAY,
				feedbackDeadline: now + 22 * DAY
			})
		).rejects.toThrow();
	});
});

describe('admin seasons endpoints', () => {
	it('adminListSeasons rejects an anonymous caller', async () => {
		const t = convexTest(schema, modules);
		await expect(t.query(api.seasons.adminListSeasons, {})).rejects.toThrow();
	});

	it('adminListSeasons rejects an authenticated non-admin', async () => {
		const t = convexTest(schema, modules);
		await seedProfile(t, 'regular-user');
		await expect(
			t.withIdentity({ subject: 'regular-user' }).query(api.seasons.adminListSeasons, {})
		).rejects.toThrow('Not authorized');
	});

	it('adminCreateSeason rejects a non-admin caller', async () => {
		const t = convexTest(schema, modules);
		await seedProfile(t, 'regular-user');
		const now = Date.now();
		await expect(
			t
				.withIdentity({ subject: 'regular-user' })
				.mutation(api.seasons.adminCreateSeason, validSeasonArgs(now))
		).rejects.toThrow('Not authorized');
	});

	it('adminCreateSeason creates a season for an admin caller and adminListSeasons returns it', async () => {
		const t = convexTest(schema, modules);
		const adminProfileId = await seedProfile(t, 'admin-user');
		await makeAdmin(t, adminProfileId);
		const now = Date.now();

		const asAdmin = t.withIdentity({ subject: 'admin-user' });
		const seasonId = await asAdmin.mutation(api.seasons.adminCreateSeason, validSeasonArgs(now));
		expect(seasonId).toBeTruthy();

		const seasons = await asAdmin.query(api.seasons.adminListSeasons, {});
		expect(seasons).toHaveLength(1);
		expect(seasons[0].name).toBe('Admin Season');
	});

	it('adminCreateSeason rejects endDate before startDate', async () => {
		const t = convexTest(schema, modules);
		const adminProfileId = await seedProfile(t, 'admin-user');
		await makeAdmin(t, adminProfileId);
		const now = Date.now();
		await expect(
			t.withIdentity({ subject: 'admin-user' }).mutation(api.seasons.adminCreateSeason, {
				...validSeasonArgs(now),
				startDate: now + 100,
				endDate: now
			})
		).rejects.toThrow();
	});

	it('adminCreateSeason rejects reviewWindowClose before reviewWindowOpen', async () => {
		const t = convexTest(schema, modules);
		const adminProfileId = await seedProfile(t, 'admin-user');
		await makeAdmin(t, adminProfileId);
		const now = Date.now();
		await expect(
			t.withIdentity({ subject: 'admin-user' }).mutation(api.seasons.adminCreateSeason, {
				...validSeasonArgs(now),
				reviewWindowOpen: now,
				reviewWindowClose: now - 100
			})
		).rejects.toThrow();
	});

	it('adminCreateSeason rejects feedbackDeadline before or equal to endDate', async () => {
		const t = convexTest(schema, modules);
		const adminProfileId = await seedProfile(t, 'admin-user');
		await makeAdmin(t, adminProfileId);
		const now = Date.now();
		await expect(
			t.withIdentity({ subject: 'admin-user' }).mutation(api.seasons.adminCreateSeason, {
				...validSeasonArgs(now),
				feedbackDeadline: now + 10 * DAY // equal to endDate
			})
		).rejects.toThrow();
	});

	it('adminUpdateSeason rejects a non-admin caller', async () => {
		const t = convexTest(schema, modules);
		const adminProfileId = await seedProfile(t, 'admin-user');
		await makeAdmin(t, adminProfileId);
		await seedProfile(t, 'regular-user');
		const now = Date.now();

		const seasonId = await t
			.withIdentity({ subject: 'admin-user' })
			.mutation(api.seasons.adminCreateSeason, validSeasonArgs(now));

		await expect(
			t.withIdentity({ subject: 'regular-user' }).mutation(api.seasons.adminUpdateSeason, {
				seasonId,
				...validSeasonArgs(now)
			})
		).rejects.toThrow('Not authorized');
	});

	it('adminUpdateSeason patches fields for an admin caller', async () => {
		const t = convexTest(schema, modules);
		const adminProfileId = await seedProfile(t, 'admin-user');
		await makeAdmin(t, adminProfileId);
		const now = Date.now();

		const asAdmin = t.withIdentity({ subject: 'admin-user' });
		const seasonId = await asAdmin.mutation(api.seasons.adminCreateSeason, validSeasonArgs(now));

		await asAdmin.mutation(api.seasons.adminUpdateSeason, {
			seasonId,
			...validSeasonArgs(now),
			name: 'Renamed Admin Season',
			endDate: now + 20 * DAY,
			feedbackDeadline: now + 22 * DAY
		});

		const seasons = await asAdmin.query(api.seasons.adminListSeasons, {});
		expect(seasons[0].name).toBe('Renamed Admin Season');
		expect(seasons[0].endDate).toBe(now + 20 * DAY);
	});

	it('adminUpdateSeason rejects an invalid date range', async () => {
		const t = convexTest(schema, modules);
		const adminProfileId = await seedProfile(t, 'admin-user');
		await makeAdmin(t, adminProfileId);
		const now = Date.now();

		const asAdmin = t.withIdentity({ subject: 'admin-user' });
		const seasonId = await asAdmin.mutation(api.seasons.adminCreateSeason, validSeasonArgs(now));

		await expect(
			asAdmin.mutation(api.seasons.adminUpdateSeason, {
				seasonId,
				...validSeasonArgs(now),
				startDate: now + 100,
				endDate: now
			})
		).rejects.toThrow();
	});
});
