import type { QueryCtx, MutationCtx } from './_generated/server';
import { components } from './_generated/api';

// Looks up the Better Auth user record for a profile's authUserId and returns its email.
// Kept in its own module so tests can mock the auth-component lookup without touching the
// rest of the notification pipeline (the betterAuth component is not available in convex-test).
export const getAuthUserEmail = async (
	ctx: QueryCtx | MutationCtx,
	authUserId: string
): Promise<string | null> => {
	const authUser = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
		model: 'user',
		where: [{ field: '_id', value: authUserId }]
	})) as { email?: string | null } | null;
	return authUser?.email ?? null;
};
