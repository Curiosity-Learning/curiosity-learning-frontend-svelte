/// <reference types="vite/client" />

// CL-777: a season's application deadline can be extended. `applicationDeadline` keeps the normal
// date, `applicationDeadlineExtendedTo` the extension, and effectiveApplicationDeadline decides.

import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { api, internal } from './_generated/api';
import schema from './schema';
import { effectiveApplicationDeadline, getApplicationIntakeSeason } from './seasons';

const modules = import.meta.glob('./**/*.ts');

const at = (iso: string) => Date.parse(iso);

const setupAdmin = async () => {
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
	return { t, admin: t.withIdentity({ subject: 'admin-user' }) };
};

const winter = {
	name: 'Winter 2026',
	applicationDeadline: '2026-10-31',
	reviewWindowClose: '2026-11-14',
	startDate: '2026-12-05',
	endDate: '2027-02-27',
	feedbackDeadline: '2027-03-13'
};

describe('effectiveApplicationDeadline', () => {
	it('is the extension when set, else the normal deadline', () => {
		expect(effectiveApplicationDeadline({ applicationDeadline: 1 })).toBe(1);
		expect(
			effectiveApplicationDeadline({ applicationDeadline: 1, applicationDeadlineExtendedTo: 2 })
		).toBe(2);
		expect(effectiveApplicationDeadline({})).toBeUndefined();
	});
});

describe('adminSaveSeason with an extension', () => {
	it('stores the extension and opens scoring at the extended date', async () => {
		const { t, admin } = await setupAdmin();
		const seasonId = await admin.mutation(api.seasons.adminSaveSeason, {
			...winter,
			applicationDeadlineExtendedTo: '2026-11-07'
		});
		expect(await t.run((ctx) => ctx.db.get(seasonId))).toMatchObject({
			applicationDeadline: at('2026-10-31T23:55:00Z'),
			applicationDeadlineExtendedTo: at('2026-11-07T23:55:00Z'),
			reviewWindowOpen: at('2026-11-07T23:55:00Z')
		});

		// Omitted (an admin portal build from before CL-777): the extension stays.
		await admin.mutation(api.seasons.adminSaveSeason, { ...winter, seasonId, name: 'Winter 26' });
		expect(await t.run((ctx) => ctx.db.get(seasonId))).toMatchObject({
			name: 'Winter 26',
			applicationDeadlineExtendedTo: at('2026-11-07T23:55:00Z'),
			reviewWindowOpen: at('2026-11-07T23:55:00Z')
		});

		// Empty: the extension is removed and scoring opens at the normal deadline again.
		await admin.mutation(api.seasons.adminSaveSeason, {
			...winter,
			seasonId,
			applicationDeadlineExtendedTo: ''
		});
		const cleared = await t.run((ctx) => ctx.db.get(seasonId));
		expect(cleared?.applicationDeadlineExtendedTo).toBeUndefined();
		expect(cleared?.reviewWindowOpen).toBe(at('2026-10-31T23:55:00Z'));
	});

	it('rejects an extension not after the normal date or not before the scoring deadline', async () => {
		const { admin } = await setupAdmin();
		await expect(
			admin.mutation(api.seasons.adminSaveSeason, {
				...winter,
				applicationDeadlineExtendedTo: '2026-10-31'
			})
		).rejects.toThrow(/extended date must be after the normal closing date/);
		await expect(
			admin.mutation(api.seasons.adminSaveSeason, {
				...winter,
				applicationDeadlineExtendedTo: '2026-11-14'
			})
		).rejects.toThrow(/scoring deadline must be after the extended closing date/);
		await expect(
			admin.mutation(api.seasons.adminSaveSeason, {
				...winter,
				applicationDeadlineExtendedTo: 'soon'
			})
		).rejects.toThrow(/Extended to: pick a date/);
	});

	it('two seasons may not really close on the same day', async () => {
		const { admin } = await setupAdmin();
		await admin.mutation(api.seasons.adminSaveSeason, {
			...winter,
			applicationDeadlineExtendedTo: '2026-11-07'
		});
		await expect(
			admin.mutation(api.seasons.adminSaveSeason, {
				...winter,
				name: 'Other',
				applicationDeadline: '2026-11-07'
			})
		).rejects.toThrow(/already closes applications/);
	});
});

describe('getApplicationIntakeSeason with an extension', () => {
	it('keeps taking applications for the season until the extended date', async () => {
		const { t, admin } = await setupAdmin();
		const winterId = await admin.mutation(api.seasons.adminSaveSeason, {
			...winter,
			applicationDeadlineExtendedTo: '2026-11-07'
		});
		const springId = await admin.mutation(api.seasons.adminSaveSeason, {
			name: 'Spring 2027',
			applicationDeadline: '2027-01-31',
			reviewWindowClose: '2027-02-07',
			startDate: '2027-03-06',
			endDate: '2027-05-29',
			feedbackDeadline: '2027-06-12'
		});
		const intakeAt = (iso: string) =>
			t.run(async (ctx) => await getApplicationIntakeSeason(ctx, at(iso)));

		// Between the normal and the extended deadline: still Winter.
		const during = await intakeAt('2026-11-03T12:00:00Z');
		expect(during?._id).toBe(winterId);
		expect(during?.closesAt).toBe(at('2026-11-07T23:55:00Z'));
		// After the extension: Spring.
		expect((await intakeAt('2026-11-08T00:00:00Z'))?._id).toBe(springId);
	});
});

describe('backfillWinter2026Extension', () => {
	const seedWinter = async (
		t: ReturnType<typeof convexTest>,
		fields: { applicationDeadline: number; applicationDeadlineExtendedTo?: number }
	) =>
		await t.run(async (ctx) => {
			const now = Date.now();
			return await ctx.db.insert('seasons', {
				name: 'Winter 2026',
				...fields,
				reviewWindowOpen: at('2026-11-07T23:55:00Z'),
				reviewWindowClose: at('2026-11-14T23:55:00Z'),
				startDate: at('2026-12-05T00:00:00Z'),
				endDate: at('2027-02-27T23:55:00Z'),
				feedbackDeadline: at('2027-03-13T23:55:00Z'),
				createdAt: now,
				updatedAt: now
			});
		});

	it('dry run changes nothing; the real run moves 7 Nov to 31 Oct + extended to 7 Nov, once', async () => {
		const t = convexTest(schema, modules);
		const seasonId = await seedWinter(t, { applicationDeadline: at('2026-11-07T23:55:00Z') });
		const before = await t.run((ctx) => ctx.db.get(seasonId));

		const dry = await t.mutation(internal.seasons.backfillWinter2026Extension, { dryRun: true });
		expect(dry.status).toBe('would_update');
		expect(await t.run((ctx) => ctx.db.get(seasonId))).toEqual(before);

		const real = await t.mutation(internal.seasons.backfillWinter2026Extension, { dryRun: false });
		expect(real.status).toBe('updated');
		const after = await t.run((ctx) => ctx.db.get(seasonId));
		expect(after).toMatchObject({
			applicationDeadline: at('2026-10-31T23:55:00Z'),
			applicationDeadlineExtendedTo: at('2026-11-07T23:55:00Z'),
			reviewWindowOpen: at('2026-11-07T23:55:00Z')
		});
		expect(effectiveApplicationDeadline(after!)).toBe(before!.applicationDeadline);

		const again = await t.mutation(internal.seasons.backfillWinter2026Extension, { dryRun: false });
		expect(again.status).toBe('already_done');
	});

	it('refuses a season that does not look like the pre-CL-777 Winter 2026', async () => {
		const t = convexTest(schema, modules);
		await seedWinter(t, { applicationDeadline: at('2026-11-06T23:55:00Z') });
		await expect(
			t.mutation(internal.seasons.backfillWinter2026Extension, { dryRun: true })
		).rejects.toThrow(/not touching it/);
	});
});
