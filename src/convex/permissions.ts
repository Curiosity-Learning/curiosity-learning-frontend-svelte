import { ConvexError } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import type { ActionCtx, QueryCtx, MutationCtx } from './_generated/server';

type AuthCtx = QueryCtx | MutationCtx | ActionCtx;
type DbCtx = QueryCtx | MutationCtx;

export const requireIdentity = async (ctx: AuthCtx) => {
	const identity = await ctx.auth.getUserIdentity();
	if (!identity) {
		throw new ConvexError('Unauthenticated');
	}
	return identity;
};

export const requireProfile = async (ctx: DbCtx, userId: string) => {
	const profile = await ctx.db
		.query('profiles')
		.withIndex('by_user_id', (q) => q.eq('userId', userId))
		.first();
	if (!profile) {
		throw new ConvexError('Profile not found');
	}
	return profile;
};

export const getMembership = async (ctx: DbCtx, clubId: Id<'clubs'>, userId: string) => {
	const memberships = await ctx.db
		.query('clubMembers')
		.withIndex('by_club_and_user', (q) => q.eq('clubId', clubId).eq('userId', userId))
		.collect();
	return memberships.find((membership) => !membership.leftAt) ?? null;
};

export const hasPermission = async (
	ctx: DbCtx,
	clubId: Id<'clubs'>,
	userId: string,
	permission: string
) => {
	const membership = await getMembership(ctx, clubId, userId);
	if (!membership) {
		return false;
	}

	const role = await ctx.db.get(membership.roleId);
	if (!role) {
		return false;
	}

	return role.permissions.includes(permission);
};

export const requirePermission = async (
	ctx: DbCtx,
	clubId: Id<'clubs'>,
	userId: string,
	permission: string
) => {
	const allowed = await hasPermission(ctx, clubId, userId, permission);
	if (!allowed) {
		throw new ConvexError('Permission denied');
	}
};

export const roleFromPermissions = (role: Doc<'clubRoles'> | null) => {
	if (!role) {
		return null;
	}
	return role.permissions.some((permission) => permission.includes(':create'))
		? 'Guide'
		: 'Learner';
};
