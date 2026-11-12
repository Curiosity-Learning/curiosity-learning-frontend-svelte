import { ConvexError } from 'convex/values';
import { components } from './_generated/api';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { requireIdentity } from './permissions';
// Stable prefix the UI detects (child page: "please sign in again").
import { FRESH_SESSION_REQUIRED } from '../lib/domain/child-notification-email';

// Fresh sign-in for sensitive parent actions (CL-768, review S5). On a shared family computer a
// parent's session can stay signed in for days; anyone using that browser (most plausibly the
// child) would otherwise be able to point the child's emails at an address they control. Changes
// like that need a session that was CREATED recently, i.e. the person just proved they are the
// parent (password, Google, or a sign-in link sent to the parent's inbox).
//
// How the age is read: the @convex-dev/better-auth convex plugin puts the Better Auth session id
// into the Convex JWT as the `sessionId` claim (plugins/convex definePayload), and the session row
// lives in the betterAuth component, readable from a mutation through the component adapter
// (the same lookup the library's own getAuthUser does). Better Auth's session refresh moves
// `expiresAt`/`updatedAt` but never `createdAt`, so `createdAt` is the time of the sign-in.
//
// Kept in its own module (not permissions.ts) so specs that run without the auth component can
// mock it, the same way authEmail.ts is mocked.

export { FRESH_SESSION_REQUIRED };

// How recent the sign-in must be for routing changes to a child's email.
export const ROUTING_CHANGE_MAX_SESSION_AGE_MS = 15 * 60 * 1000;

type SessionRow = { _id: string; userId: string; createdAt: number; expiresAt: number };

export const requireFreshSession = async (ctx: QueryCtx | MutationCtx, maxAgeMs: number) => {
	const identity = await requireIdentity(ctx);
	const sessionId = typeof identity.sessionId === 'string' ? identity.sessionId : null;
	const session = sessionId
		? ((await ctx.runQuery(components.betterAuth.adapter.findOne, {
				model: 'session',
				where: [{ field: '_id', value: sessionId }]
			})) as SessionRow | null)
		: null;
	const now = Date.now();
	if (
		!session ||
		session.userId !== identity.subject ||
		session.expiresAt <= now ||
		now - session.createdAt > maxAgeMs
	) {
		throw new ConvexError(
			`${FRESH_SESSION_REQUIRED}: For your security, please sign in again to change this.`
		);
	}
};
