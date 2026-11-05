import { ConvexError } from 'convex/values';
import type { UserIdentity } from 'convex/server';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import type { ActionCtx, QueryCtx, MutationCtx } from './_generated/server';
import type { ClubRoleKey, ProjectRoleKey } from './roles';

type AuthCtx = QueryCtx | MutationCtx | ActionCtx;
type DbCtx = QueryCtx | MutationCtx;

// ---------------------------------------------------------------------------------------------
// Parent "View as Child" (CL-734). A parent session can switch into viewing the app exactly as
// one of their linked children: a `parentViewSessions` row keyed by (parent auth user, Better
// Auth session id) records which child. While that row exists and the parent link still holds:
//   - QUERIES see the child's identity (`subject` swapped to the child's auth user id), so every
//     screen — clubs, feed, chat, profile, sidebar — renders the child's interface without any
//     per-query changes.
//   - MUTATIONS and ACTIONS are refused (read-only), so nothing can ever be written as the
//     child. Parent-scoped functions that must keep working (start/stop viewing, Report Issue,
//     parent-link sync) read the real identity via `requireRealIdentity`.
// Queries and mutations are told apart by the database handle: Convex gives queries a reader
// with no `insert`, mutations a writer.
// ---------------------------------------------------------------------------------------------

export const VIEW_AS_READ_ONLY_CODE = 'VIEW_AS_READ_ONLY';

export type ViewingAsChild = {
	parentAuthUserId: string;
	parentProfileId: Id<'profiles'>;
	childProfileId: Id<'profiles'>;
	childAuthUserId: string;
};

const readOnlyError = () =>
	new ConvexError({
		code: VIEW_AS_READ_ONLY_CODE,
		message: "You're viewing as your child. Switch back to your account to make changes."
	});

const isWriterCtx = (ctx: DbCtx) => typeof (ctx.db as { insert?: unknown }).insert === 'function';

export const getIdentitySessionId = (identity: UserIdentity): string | null => {
	const sessionId = (identity as { sessionId?: unknown }).sessionId;
	return typeof sessionId === 'string' && sessionId.length > 0 ? sessionId : null;
};

/**
 * The child this (real, un-swapped) identity is currently viewing as, or null. Re-checks the
 * parent link and the child profile every time, so unlinking ends the view immediately.
 */
export const resolveViewingAsChild = async (
	ctx: DbCtx,
	realIdentity: UserIdentity
): Promise<ViewingAsChild | null> => {
	const sessionId = getIdentitySessionId(realIdentity);
	if (!sessionId) return null;
	const viewSession = await ctx.db
		.query('parentViewSessions')
		.withIndex('by_parent_auth_user_and_session', (q) =>
			q.eq('parentAuthUserId', realIdentity.subject).eq('sessionId', sessionId)
		)
		.first();
	if (!viewSession) return null;
	const link = await ctx.db
		.query('parentLinks')
		.withIndex('by_parent_and_child', (q) =>
			q
				.eq('parentProfileId', viewSession.parentProfileId)
				.eq('childProfileId', viewSession.childProfileId)
		)
		.first();
	if (!link) return null;
	const child = await ctx.db.get(viewSession.childProfileId);
	if (!child?.authUserId) return null;
	return {
		parentAuthUserId: realIdentity.subject,
		parentProfileId: viewSession.parentProfileId,
		childProfileId: child._id,
		childAuthUserId: child.authUserId
	};
};

/** The caller's own identity, never swapped. Only for parent-scoped functions (see above). */
export const getRealIdentity = async (ctx: AuthCtx) => await ctx.auth.getUserIdentity();

export const requireRealIdentity = async (ctx: AuthCtx) => {
	const identity = await getRealIdentity(ctx);
	if (!identity) {
		throw new ConvexError('Unauthenticated');
	}
	return identity;
};

/**
 * The identity every app function should act as: the caller, or — while a parent is viewing as
 * a child — the child (queries only; mutations and actions throw a read-only error).
 */
export const getViewerIdentity = async (ctx: AuthCtx): Promise<UserIdentity | null> => {
	const identity = await ctx.auth.getUserIdentity();
	if (!identity) return null;
	if (!('db' in ctx)) {
		// Actions have no database; ask a query. Any active view makes the action read-only.
		const viewing = await ctx.runQuery(internal.viewAs.getViewingAsForCaller, {});
		if (viewing) throw readOnlyError();
		return identity;
	}
	const viewing = await resolveViewingAsChild(ctx, identity);
	if (!viewing) return identity;
	if (isWriterCtx(ctx)) throw readOnlyError();
	return { ...identity, subject: viewing.childAuthUserId };
};

export const requireIdentity = async (ctx: AuthCtx) => {
	const identity = await getViewerIdentity(ctx);
	if (!identity) {
		throw new ConvexError('Unauthenticated');
	}
	return identity;
};

/** For background-style mutations that should quietly do nothing while a parent is viewing. */
export const isViewingAsChild = async (ctx: DbCtx) => {
	const identity = await ctx.auth.getUserIdentity();
	if (!identity) return false;
	return (await resolveViewingAsChild(ctx, identity)) !== null;
};

export const getProfileAuthUserId = (profile: Doc<'profiles'>) => profile.authUserId;

// WARNING: this resolves a profile with NO suspension check — calling it directly bypasses PRD
// 6.14.7's account-suspension enforcement (see `requireProfile` below, which wraps this with
// `requireNotSuspended` and is the choke point that enforcement relies on). Mutations/queries that
// should be blocked for a suspended user MUST go through `requireProfile`, not this function,
// unless the bypass is deliberate. As of this writing there are exactly two intentional
// exemptions: `reports.submitReport` (the PRD requires "Report Issue" to stay reachable from the
// account-suspended screen) and `notifications.unreadCount` (a best-effort badge count that
// degrades to 0 for a missing/unauthenticated profile rather than throwing, and has no reason to
// hide the count from a suspended account). Any other direct caller of this function should be
// treated as a candidate bug, not precedent.
export const getProfileByAuthUserId = async (ctx: DbCtx, authUserId: string) => {
	return await ctx.db
		.query('profiles')
		.withIndex('by_auth_user_id', (q) => q.eq('authUserId', authUserId))
		.unique();
};

// PRD 6.14.7 (CL-730): pragmatic v1 suspension enforcement choke point. `requireProfile` is the
// single highest-traffic helper shared by virtually every authenticated mutation/query across the
// app (clubs, projects, updates, comments, chat, notifications, etc. — see callers), so gating
// here gives broad coverage for one small change instead of threading a check through every
// individual mutation. Honest limitation: this only covers callers that go through
// `requireProfile` — anything that resolves the profile via `getProfileByAuthUserId` directly
// bypasses it (deliberately, in one case: `reports.submitReport` — the PRD requires "Report
// Issue" to stay reachable from the account-suspended screen, so that mutation intentionally does
// not block suspended users). Not a guarantee against future code adding new direct
// `getProfileByAuthUserId` callers around this check.
export const requireProfile = async (ctx: DbCtx, authUserId: string) => {
	const profile = await getProfileByAuthUserId(ctx, authUserId);
	if (!profile) {
		throw new ConvexError('Profile not found');
	}
	requireNotSuspended(profile);
	return profile;
};

export const requireNotSuspended = (profile: Doc<'profiles'>) => {
	if (profile.suspendedAt) {
		throw new ConvexError('Account suspended');
	}
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
	const attributionRows = await ctx.db
		.query('projectAttributions')
		.withIndex('by_project', (q) => q.eq('projectId', projectId))
		.collect();
	const attributedClubIds = [...new Set(attributionRows.map((row) => row.clubId))];

	for (const clubId of attributedClubIds) {
		if (await hasPermission(ctx, clubId, userId, permission)) {
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

// PRD 5.10: platform-wide capability gate for the /admin route group (CL-693). Deliberately
// separate from club/project permissions above — must never be consulted by normal member flows.
export const isGlobalAdmin = async (ctx: DbCtx, authUserId: string) => {
	const profile = await getProfileByAuthUserId(ctx, authUserId);
	return profile?.globalRole === 'admin';
};

export const requireGlobalAdmin = async (ctx: AuthCtx & DbCtx) => {
	const identity = await requireIdentity(ctx);
	if (!(await isGlobalAdmin(ctx, identity.subject))) {
		throw new ConvexError('Not authorized');
	}
	return identity;
};
