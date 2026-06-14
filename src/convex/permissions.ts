import { ConvexError } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import type { ActionCtx, QueryCtx, MutationCtx } from './_generated/server';
import {
	legacyClubRoleName,
	legacyProjectRoleName,
	type ClubRoleKey,
	type ProjectRoleKey
} from './roles';

type AuthCtx = QueryCtx | MutationCtx | ActionCtx;
type DbCtx = QueryCtx | MutationCtx;

export const requireIdentity = async (ctx: AuthCtx) => {
	const identity = await ctx.auth.getUserIdentity();
	if (!identity) {
		throw new ConvexError('Unauthenticated');
	}
	return identity;
};

export const getProfileAuthUserId = (profile: Doc<'profiles'>) =>
	profile.authUserId ?? profile.userId ?? null;

export const getProfileByAuthUserId = async (ctx: DbCtx, authUserId: string) => {
	const profile = await ctx.db
		.query('profiles')
		.withIndex('by_auth_user_id', (q) => q.eq('authUserId', authUserId))
		.unique();
	if (profile) {
		return profile;
	}

	return await ctx.db
		.query('profiles')
		.withIndex('by_user_id', (q) => q.eq('userId', authUserId))
		.unique();
};

export const requireProfile = async (ctx: DbCtx, authUserId: string) => {
	const profile = await getProfileByAuthUserId(ctx, authUserId);
	if (!profile) {
		throw new ConvexError('Profile not found');
	}
	return profile;
};

export const getRelatedProfile = async (
	ctx: DbCtx,
	profileId?: Id<'profiles'>,
	legacyAuthUserId?: string
) => {
	if (profileId) {
		return await ctx.db.get(profileId);
	}
	return legacyAuthUserId ? await getProfileByAuthUserId(ctx, legacyAuthUserId) : null;
};

export const requireProfileAuthUserId = (profile: Doc<'profiles'>) => {
	const authUserId = getProfileAuthUserId(profile);
	if (!authUserId) {
		throw new ConvexError('Profile is not linked to an auth user');
	}
	return authUserId;
};

export const getMembershipByProfileId = async (
	ctx: DbCtx,
	clubId: Id<'clubs'>,
	profileId: Id<'profiles'>
) => {
	const memberships = await ctx.db
		.query('clubMembers')
		.withIndex('by_club_and_profile', (q) => q.eq('clubId', clubId).eq('profileId', profileId))
		.collect();
	const membership = memberships.find((row) => !row.leftAt) ?? null;
	if (membership) {
		return membership.leftAt ? null : membership;
	}

	const profile = await ctx.db.get(profileId);
	const authUserId = profile ? getProfileAuthUserId(profile) : null;
	if (!authUserId) {
		return null;
	}
	const legacyMemberships = await ctx.db
		.query('clubMembers')
		.withIndex('by_club_and_user', (q) => q.eq('clubId', clubId).eq('userId', authUserId))
		.collect();
	return legacyMemberships.find((row) => !row.leftAt) ?? null;
};

export const getMembership = async (ctx: DbCtx, clubId: Id<'clubs'>, authUserId: string) => {
	const profile = await getProfileByAuthUserId(ctx, authUserId);
	return profile ? await getMembershipByProfileId(ctx, clubId, profile._id) : null;
};

export const listMembershipsForProfile = async (ctx: DbCtx, profile: Doc<'profiles'>) => {
	const byProfile = await ctx.db
		.query('clubMembers')
		.withIndex('by_profile', (q) => q.eq('profileId', profile._id))
		.collect();
	const authUserId = getProfileAuthUserId(profile);
	const legacy = authUserId
		? await ctx.db
				.query('clubMembers')
				.withIndex('by_user', (q) => q.eq('userId', authUserId))
				.collect()
		: [];
	return [...new Map([...byProfile, ...legacy].map((row) => [row._id, row])).values()];
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
	const role = await ctx.db
		.query('clubRoles')
		.withIndex('by_key', (q) => q.eq('key', key))
		.unique();
	if (role) {
		return role;
	}
	return await ctx.db
		.query('clubRoles')
		.withIndex('by_name', (q) => q.eq('name', legacyClubRoleName[key]))
		.unique();
};

export const getProjectRoleByKey = async (ctx: DbCtx, key: ProjectRoleKey) => {
	const role = await ctx.db
		.query('projectRoles')
		.withIndex('by_key', (q) => q.eq('key', key))
		.unique();
	if (role) {
		return role;
	}
	return await ctx.db
		.query('projectRoles')
		.withIndex('by_name', (q) => q.eq('name', legacyProjectRoleName[key]))
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
	const legacyMemberships = await ctx.db
		.query('projectMembers')
		.withIndex('by_project_and_user', (q) => q.eq('projectId', projectId).eq('userId', userId))
		.collect();
	const membership = [...memberships, ...legacyMemberships].find((row) => !row.leftAt) ?? null;
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
	if (role.key) {
		return role.key === 'guide' ? 'Guide' : 'Learner';
	}
	return role.permissions.some((permission) => permission.includes(':create'))
		? 'Guide'
		: 'Learner';
};
