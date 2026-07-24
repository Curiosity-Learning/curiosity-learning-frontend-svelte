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

// Email plus verification state, for flows that must not trust an unverified address
// (adminInvites.claimAdminInvite grants the global admin role off an email match).
export const getAuthUserEmailInfo = async (
	ctx: QueryCtx | MutationCtx,
	authUserId: string
): Promise<{ email: string; emailVerified: boolean } | null> => {
	const authUser = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
		model: 'user',
		where: [{ field: '_id', value: authUserId }]
	})) as { email?: string | null; emailVerified?: boolean | null } | null;
	if (!authUser?.email) {
		return null;
	}
	return { email: authUser.email, emailVerified: authUser.emailVerified === true };
};

// Reverse lookup: Better Auth user id for an email, or null if no account exists yet.
// Better Auth stores emails lowercased, so callers should pass a normalized email.
export const getAuthUserIdByEmail = async (
	ctx: QueryCtx | MutationCtx,
	email: string
): Promise<string | null> => {
	const authUser = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
		model: 'user',
		where: [{ field: 'email', value: email }]
	})) as { _id?: string | null } | null;
	return authUser?._id ?? null;
};
