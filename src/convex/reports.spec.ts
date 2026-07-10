/// <reference types="vite/client" />

import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

const seedProfile = async (t: ReturnType<typeof convexTest>, authUserId: string) => {
	return await t.run(async (ctx) => {
		const now = Date.now();
		return await ctx.db.insert('profiles', {
			authUserId,
			username: authUserId,
			firstName: 'Test',
			lastName: 'User',
			isVerified: true,
			firstLoginCompleted: true,
			updatedAt: now
		});
	});
};

describe('reports.submitReport', () => {
	it('stores a report row and schedules a Google Chat alert', async () => {
		const t = convexTest(schema, modules);
		await seedProfile(t, 'reporter-user');

		const result = await t.withIdentity({ subject: 'reporter-user' }).mutation(api.reports.submitReport, {
			category: 'safeguarding',
			description: 'Something concerning happened.',
			targetType: 'chat_message',
			targetId: 'fake-message-id',
			contextText: 'The original message text'
		});

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error('expected ok result');

		const stored = await t.run((ctx) => ctx.db.get(result.reportId));
		expect(stored).toMatchObject({
			category: 'safeguarding',
			description: 'Something concerning happened.',
			targetType: 'chat_message',
			targetId: 'fake-message-id',
			contextText: 'The original message text',
			status: 'open'
		});

		const scheduledJobs = await t.run((ctx) => ctx.db.system.query('_scheduled_functions').collect());
		expect(scheduledJobs).toHaveLength(1);
		expect(scheduledJobs[0]?.name).toContain('notifyReportSubmitted');

		// Draining the scheduled action must not throw — with no GOOGLE_CHAT_WEBHOOK_URL configured
		// in the test environment, notifyReportSubmitted skips the network call and swallows any
		// error via reportConvexError instead of rethrowing.
		await t.finishAllScheduledFunctions(() => Promise.resolve());
	});

	it('allows a user with no club membership to submit a report', async () => {
		const t = convexTest(schema, modules);
		await seedProfile(t, 'no-club-user');

		const result = await t.withIdentity({ subject: 'no-club-user' }).mutation(api.reports.submitReport, {
			category: 'other',
			targetType: 'club',
			targetId: 'some-club-id'
		});

		expect(result.ok).toBe(true);
	});

	it('rejects a description over the max length', async () => {
		const t = convexTest(schema, modules);
		await seedProfile(t, 'reporter-user');

		await expect(
			t.withIdentity({ subject: 'reporter-user' }).mutation(api.reports.submitReport, {
				category: 'other',
				description: 'a'.repeat(2001),
				targetType: 'user',
				targetId: 'some-profile-id'
			})
		).rejects.toThrow();
	});

	it('rate limits after 10 submissions within the window', async () => {
		const t = convexTest(schema, modules);
		await seedProfile(t, 'reporter-user');
		const identity = t.withIdentity({ subject: 'reporter-user' });

		for (let attempt = 0; attempt < 10; attempt += 1) {
			const result = await identity.mutation(api.reports.submitReport, {
				category: 'other',
				targetType: 'club',
				targetId: `club-${attempt}`
			});
			expect(result.ok).toBe(true);
		}

		const limitedResult = await identity.mutation(api.reports.submitReport, {
			category: 'other',
			targetType: 'club',
			targetId: 'club-11th'
		});
		expect(limitedResult).toEqual({ ok: false, error: 'rate_limited' });

		const reports = await t.run((ctx) => ctx.db.query('reports').collect());
		expect(reports).toHaveLength(10);
	});

	it('requires authentication', async () => {
		const t = convexTest(schema, modules);
		await expect(
			t.mutation(api.reports.submitReport, {
				category: 'other',
				targetType: 'club',
				targetId: 'some-club-id'
			})
		).rejects.toThrow();
	});
});
