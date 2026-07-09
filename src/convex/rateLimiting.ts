import type { MutationCtx, QueryCtx } from './_generated/server';

export type RateLimitOptions = {
	maxAttempts: number;
	windowMs: number;
};

/**
 * Fixed-window rate limiter backed by the `rateLimits` table.
 *
 * Design note: Convex mutations are all-or-nothing — if a mutation throws, ALL of its writes
 * (including `ctx.scheduler` calls) are rolled back. A limiter that throws from the same
 * mutation that records the attempt would therefore never persist failed-attempt counts.
 * Instead, callers use two primitives and return structured results rather than throwing on
 * the rate-limited code paths:
 *
 * 1. `isRateLimited(ctx, key, opts)` — read-only check. If it returns true, the caller should
 *    return a structured `rate_limited` result (no write needed).
 * 2. `recordRateLimitAttempt(ctx, key, opts)` — direct write that increments the counter (or
 *    resets it when the window has elapsed). The caller must NOT throw after calling this on
 *    the code path being counted, or the increment is rolled back.
 *
 * This is a simple fixed-window limiter (not sliding/token-bucket) — adequate for brute-force
 * damping without extra bookkeeping complexity.
 */
export const isRateLimited = async (
	ctx: QueryCtx | MutationCtx,
	key: string,
	{ maxAttempts, windowMs }: RateLimitOptions
): Promise<boolean> => {
	const existing = await ctx.db
		.query('rateLimits')
		.withIndex('by_key', (q) => q.eq('key', key))
		.unique();

	return Boolean(
		existing && Date.now() - existing.windowStart < windowMs && existing.count >= maxAttempts
	);
};

export const recordRateLimitAttempt = async (
	ctx: MutationCtx,
	key: string,
	{ windowMs }: RateLimitOptions
): Promise<void> => {
	const now = Date.now();
	const existing = await ctx.db
		.query('rateLimits')
		.withIndex('by_key', (q) => q.eq('key', key))
		.unique();

	if (!existing) {
		await ctx.db.insert('rateLimits', { key, windowStart: now, count: 1 });
		return;
	}

	if (now - existing.windowStart >= windowMs) {
		await ctx.db.patch(existing._id, { windowStart: now, count: 1 });
		return;
	}

	await ctx.db.patch(existing._id, { count: existing.count + 1 });
};
