import { MINUTE, RateLimiter } from '@convex-dev/rate-limiter';
import { components } from './_generated/api';
import type { MutationCtx } from './_generated/server';

/**
 * Limits backed by the official `@convex-dev/rate-limiter` component (CL-817). It is
 * transactional, fails closed and cleans up its own rows, unlike the hand-rolled fixed window
 * in `rateLimiting.ts` (still used by other flows).
 *
 * Club-code lookups are keyed per caller, never per code: a per-code bucket let one attacker
 * use up a real club's code so legitimate joiners were refused.
 */
export const rateLimiter = new RateLimiter(components.rateLimiter, {
	// One signed-in user guessing codes.
	clubCodeLookupUser: { kind: 'token bucket', rate: 20, period: MINUTE, capacity: 20 },
	// One anonymous client, by IP. Requests without an IP (scheduled jobs) share one bucket.
	clubCodeLookupIp: { kind: 'token bucket', rate: 20, period: MINUTE, capacity: 20 },
	// Backstop across every caller, against distributed guessing.
	clubCodeLookupGlobal: { kind: 'fixed window', rate: 600, period: MINUTE }
});

const NO_IP_KEY = 'no-ip';

export const clubCodeLookupCallerKey = (authUserId: string | null, ip: string | null) =>
	authUserId
		? { name: 'clubCodeLookupUser' as const, key: `user:${authUserId}` }
		: { name: 'clubCodeLookupIp' as const, key: ip ? `ip:${ip}` : NO_IP_KEY };

/**
 * Consumes one club-code lookup for the caller and the global backstop. Returns false when
 * either is exhausted; the caller must then return (not throw) so nothing else happens.
 */
export const consumeClubCodeLookup = async (ctx: MutationCtx): Promise<boolean> => {
	const identity = await ctx.auth.getUserIdentity();
	const { ip } = await ctx.meta.getRequestMetadata();
	const caller = clubCodeLookupCallerKey(identity?.subject ?? null, ip);

	const callerStatus = await rateLimiter.limit(ctx, caller.name, { key: caller.key });
	if (!callerStatus.ok) {
		return false;
	}

	const globalStatus = await rateLimiter.limit(ctx, 'clubCodeLookupGlobal');
	return globalStatus.ok;
};
