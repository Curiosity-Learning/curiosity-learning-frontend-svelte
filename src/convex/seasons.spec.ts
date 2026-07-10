/// <reference types="vite/client" />

import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { api, internal } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

const DAY = 24 * 60 * 60 * 1000;

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
