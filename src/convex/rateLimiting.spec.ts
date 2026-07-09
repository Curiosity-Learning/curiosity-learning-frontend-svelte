import { convexTest } from 'convex-test';
import { describe, expect, it, vi, afterEach } from 'vitest';
import schema from './schema';
import { isRateLimited, recordRateLimitAttempt } from './rateLimiting';

const modules = import.meta.glob('./**/*.ts');

const LIMIT = { maxAttempts: 3, windowMs: 60_000 };

afterEach(() => {
	vi.useRealTimers();
});

describe('rate limiter primitives', () => {
	it('is not limited before any attempts are recorded', async () => {
		const t = convexTest(schema, modules);
		const limited = await t.run((ctx) => isRateLimited(ctx, 'key-1', LIMIT));
		expect(limited).toBe(false);
	});

	it('records attempts and reports limited once maxAttempts is reached', async () => {
		const t = convexTest(schema, modules);

		for (let attempt = 0; attempt < 3; attempt += 1) {
			await t.run(async (ctx) => {
				expect(await isRateLimited(ctx, 'key-2', LIMIT)).toBe(false);
				await recordRateLimitAttempt(ctx, 'key-2', LIMIT);
			});
		}

		const limited = await t.run((ctx) => isRateLimited(ctx, 'key-2', LIMIT));
		expect(limited).toBe(true);

		const row = await t.run((ctx) =>
			ctx.db
				.query('rateLimits')
				.withIndex('by_key', (q) => q.eq('key', 'key-2'))
				.unique()
		);
		expect(row?.count).toBe(3);
	});

	it('resets the window after windowMs elapses', async () => {
		vi.useFakeTimers();
		const t = convexTest(schema, modules);
		const shortLimit = { maxAttempts: 1, windowMs: 1_000 };

		await t.run(async (ctx) => {
			await recordRateLimitAttempt(ctx, 'key-3', shortLimit);
			expect(await isRateLimited(ctx, 'key-3', shortLimit)).toBe(true);
		});

		vi.advanceTimersByTime(1_001);

		await t.run(async (ctx) => {
			expect(await isRateLimited(ctx, 'key-3', shortLimit)).toBe(false);
			// Recording after expiry starts a fresh window with count 1.
			await recordRateLimitAttempt(ctx, 'key-3', shortLimit);
		});

		const row = await t.run((ctx) =>
			ctx.db
				.query('rateLimits')
				.withIndex('by_key', (q) => q.eq('key', 'key-3'))
				.unique()
		);
		expect(row?.count).toBe(1);
	});

	it('tracks separate keys independently', async () => {
		const t = convexTest(schema, modules);
		const singleLimit = { maxAttempts: 1, windowMs: 60_000 };

		await t.run(async (ctx) => {
			await recordRateLimitAttempt(ctx, 'key-a', singleLimit);
		});

		await t.run(async (ctx) => {
			expect(await isRateLimited(ctx, 'key-a', singleLimit)).toBe(true);
			expect(await isRateLimited(ctx, 'key-b', singleLimit)).toBe(false);
		});
	});
});
