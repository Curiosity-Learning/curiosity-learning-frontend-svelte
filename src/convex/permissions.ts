import { ConvexError } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import type { ActionCtx, QueryCtx, MutationCtx } from './_generated/server';
import type { ClubRoleKey, ProjectRoleKey } from './roles';

type AuthCtx = QueryCtx | MutationCtx | ActionCtx;
type DbCtx = QueryCtx | MutationCtx;

export const requireIdentity = async (ctx: AuthCtx) => {
	const identity = await ctx.auth.getUserIdentity();
	if (!identity) {
		throw new ConvexError('Unauthenticated');
	}
	return identity;
};

export const getProfileAuthUserId = (profile: Doc<'profiles'>) => profile.authUserId;

export const getProfileByAuthUserId = async (ctx: DbCtx, authUserId: string) => {
	return await ctx.db
		.query('profiles')
		.withIndex('by_auth_user_id', (q) => q.eq('authUserId', authUserId))
		.unique();
};

export const requireProfile = async (ctx: DbCtx, authUserId: string) => {
	const profile = await getProfileByAuthUserId(ctx, authUserId);
	if (!profile) {
		throw new ConvexError('Profile not found');
	}
	return profile;
};

export const getRelatedProfile = async (ctx: DbCtx, profileId?: Id<'profiles'>) =>
	profileId ? await ctx.db.get(profileId) : null;

export const requireProfileAuthUserId = (profile: Doc<'profiles'>) => profile.authUserId;

export const getMembershipByProfileId = async (
	ctx: DbCtx,
	clubId: Id<'clubs'>,
	profileId: Id<'profiles'>
) => {
	return (
		(
			await ctx.db
				.query('clubMembers')
				.withIndex('by_club_and_profile', (q) => q.eq('clubId', clubId).eq('profileId', profileId))
				.collect()
		).find((row) => !row.leftAt) ?? null
	);
};

export const getMembership = async (ctx: DbCtx, clubId: Id<'clubs'>, authUserId: string) => {
	const profile = await getProfileByAuthUserId(ctx, authUserId);
	return profile ? await getMembershipByProfileId(ctx, clubId, profile._id) : null;
};

export const listMembershipsForProfile = async (ctx: DbCtx, profile: Doc<'profiles'>) => {
	return await ctx.db
		.query('clubMembers')
		.withIndex('by_profile', (q) => q.eq('profileId', profile._id))
		.collect();
};

export const hasPermissionForProfile = async (
	ctx: DbCtx,
	clubId: Id<'clubs'>,
	profileId: Id<'profiles'>,
	permission: string
) => {
	const membership = await getMembershipByProfileId(ctx, clubId, profileId);
	if (!membership) {
		return false;
	}

	const role = await ctx.db.get(membership.roleId);
	if (!role) {
		return false;
	}

	return role.permissions.includes(permission);
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

export const getClubRoleByKey = async (ctx: DbCtx, key: ClubRoleKey) => {
	return await ctx.db
		.query('clubRoles')
		.withIndex('by_key', (q) => q.eq('key', key))
		.unique();
};

export const getProjectRoleByKey = async (ctx: DbCtx, key: ProjectRoleKey) => {
	return await ctx.db
		.query('projectRoles')
		.withIndex('by_key', (q) => q.eq('key', key))
		.unique();
};

export const isProjectPermissionAllowed = async (
	ctx: DbCtx,
	projectId: Id<'projects'>,
	userId: string,
	permission: string
) => {
	const links = await ctx.db
		.query('projectClubs')
		.withIndex('by_project', (q) => q.eq('projectId', projectId))
		.collect();

	for (const link of links) {
		if (await hasPermission(ctx, link.clubId, userId, permission)) {
			return true;
		}
	}

	const profile = await getProfileByAuthUserId(ctx, userId);
	if (!profile) {
		return false;
	}
	const memberships = await ctx.db
		.query('projectMembers')
		.withIndex('by_project_and_profile', (q) =>
			q.eq('projectId', projectId).eq('profileId', profile._id)
		)
		.collect();
	const membership = memberships.find((row) => !row.leftAt) ?? null;
	if (!membership || membership.leftAt) {
		return false;
	}

	const role = await ctx.db.get(membership.roleId);
	return role?.permissions.includes(permission) ?? false;
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
	return role.key === 'guide' ? 'Guide' : 'Learner';
};
