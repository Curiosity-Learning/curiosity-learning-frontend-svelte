import { ConvexError } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { getMembershipByProfileId, getProfileByAuthUserId } from './permissions';

type Ctx = QueryCtx | MutationCtx;

/**
 * PRD 6.6.4/6.6.5: a project is "Archived" once every current (not-left) member has pressed
 * "I'm Done" (`projectMembers.doneDate` set). Archival is the one event that closes the
 * project chat permanently for everyone (see `chat.ts`'s `getProjectAccess`), and is also
 * the moment `projects.archivedAt` gets set (see `projects.ts`'s `markSelfDone`) for cheap
 * "is this project archived" queries elsewhere (e.g. Showcase filtering). Projects with no
 * current members are not considered archived (nothing to archive).
 *
 * This is the single source of truth for archival status: both `chat.ts` (chat close/read
 * behavior) and `projects.ts` (setting `archivedAt` + change log) call this helper rather than
 * each re-deriving the condition, so the definition of "archived" cannot drift between them.
 */
export const isProjectArchived = async (ctx: Ctx, projectId: Id<'projects'>): Promise<boolean> => {
	const memberships = await ctx.db
		.query('projectMembers')
		.withIndex('by_project', (q) => q.eq('projectId', projectId))
		.collect();
	const currentMemberships = memberships.filter((membership) => !membership.leftAt);
	if (currentMemberships.length === 0) {
		return false;
	}
	return currentMemberships.every((membership) => Boolean(membership.doneDate));
};

/**
 * Per-member lifecycle state (PRD 6.6.4): `active` (no doneDate, no leftAt), `done` (doneDate
 * set, not left), `left` (leftAt set). Left members are excluded from team-list UI entirely;
 * this helper is for classifying a single membership row's state, not for filtering lists.
 */
export type ProjectMemberState = 'active' | 'done' | 'left';

export const getProjectMemberState = (membership: {
	leftAt?: number;
	doneDate?: number;
}): ProjectMemberState => {
	if (membership.leftAt) return 'left';
	if (membership.doneDate) return 'done';
	return 'active';
};

/**
 * Finds the caller's own current (not-left) project membership row, or throws if the caller
 * isn't a member. Used by self-only mutations (`markSelfDone`, `leaveProject`) and by the
 * "Done members can't edit" guard shared by `projects.update` and `updates.create`.
 */
export const requireOwnProjectMembership = async (
	ctx: Ctx,
	projectId: Id<'projects'>,
	authUserId: string
): Promise<Doc<'projectMembers'>> => {
	const profile = await getProfileByAuthUserId(ctx, authUserId);
	if (!profile) {
		throw new ConvexError('Profile not found');
	}

	const memberships = await ctx.db
		.query('projectMembers')
		.withIndex('by_project_and_profile', (q) =>
			q.eq('projectId', projectId).eq('profileId', profile._id)
		)
		.collect();
	const membership = memberships.find((row) => !row.leftAt);
	if (!membership) {
		throw new ConvexError('You are not a member of this project');
	}

	return membership;
};

/**
 * Guard for mutations that only active (non-Done, non-left) members may perform: editing
 * project metadata (PRD 6.6.4 "Done members cannot edit project metadata or change
 * attribution") and posting updates. No-op (does not throw) for callers who manage the
 * project via a club role rather than direct membership (e.g. a Guide with project:update
 * who isn't a project member) — only an existing Done membership blocks the action.
 */
export const assertNotDoneMember = async (
	ctx: Ctx,
	projectId: Id<'projects'>,
	authUserId: string
): Promise<void> => {
	const profile = await getProfileByAuthUserId(ctx, authUserId);
	if (!profile) return;

	const memberships = await ctx.db
		.query('projectMembers')
		.withIndex('by_project_and_profile', (q) =>
			q.eq('projectId', projectId).eq('profileId', profile._id)
		)
		.collect();
	const membership = memberships.find((row) => !row.leftAt);
	if (membership?.doneDate) {
		throw new ConvexError('Done members cannot edit this project');
	}
};

/**
 * Guard for mutations that only a CURRENT (non-left) project member — or a caller with no
 * project-membership history at all, e.g. a Guide managing via club role who never joined the
 * project directly — may perform: posting updates (PRD 6.7.1). `isProjectPermissionAllowed`
 * (used by `canManageProject`) grants access purely from an attributed club role, without
 * regard to the caller's own `projectMembers` row, so a member who has explicitly left the
 * project would otherwise still pass that check via a Guide role in an attributed club. This
 * helper closes that gap by explicitly rejecting anyone with a `leftAt` project-membership row
 * (their most recent one) for this project, independent of `assertNotDoneMember`'s Done check.
 */
export const assertNotLeftMember = async (
	ctx: Ctx,
	projectId: Id<'projects'>,
	authUserId: string
): Promise<void> => {
	const profile = await getProfileByAuthUserId(ctx, authUserId);
	if (!profile) return;

	const memberships = await ctx.db
		.query('projectMembers')
		.withIndex('by_project_and_profile', (q) =>
			q.eq('projectId', projectId).eq('profileId', profile._id)
		)
		.collect();
	if (!memberships.length) return;

	// Most recent membership row wins (mirrors `getProjectMemberState`'s intent): if it's a
	// `leftAt` row, the caller has left the project and may not post updates, even if they
	// retain a club role that would otherwise grant `project:update`.
	const mostRecent = [...memberships].sort((a, b) => b.createdAt - a.createdAt)[0];
	if (mostRecent.leftAt) {
		throw new ConvexError('You have left this project and cannot post updates.');
	}
};

export const insertProjectChangeLog = async (
	ctx: MutationCtx,
	args: {
		projectId: Id<'projects'>;
		actorProfileId: Id<'profiles'> | null;
		entryType: Doc<'projectChangeLogs'>['entryType'];
		text: string;
	}
) => {
	await ctx.db.insert('projectChangeLogs', {
		projectId: args.projectId,
		actorProfileId: args.actorProfileId ?? undefined,
		entryType: args.entryType,
		text: args.text,
		createdAt: Date.now()
	});
};

/**
 * PRD 5.11/6.6.6: a project's "attributed clubs" is the distinct set of `clubId`s across all its
 * `projectAttributions` rows (per-member links), regardless of which member owns each row. This
 * is the single source of truth other helpers/queries should use rather than re-querying
 * `projectAttributions` and de-duping themselves.
 */
export const listAttributedClubIds = async (
	ctx: Ctx,
	projectId: Id<'projects'>
): Promise<Array<Id<'clubs'>>> => {
	const rows = await ctx.db
		.query('projectAttributions')
		.withIndex('by_project', (q) => q.eq('projectId', projectId))
		.collect();
	return [...new Set(rows.map((row) => row.clubId))];
};

/**
 * PRD 6.6.2/6.6.11: direct-access (getById and other project-detail reads) visibility gate.
 * 'global' projects are viewable by any authenticated user. 'clubs' projects are viewable only
 * by (a) members of a club the project is currently attributed to (`projectAttributions`), or (b)
 * the project's own members (so a member can still view/manage a project after leaving every
 * attributed club, or one with zero attribution at all). This is intentionally independent of
 * `isProjectPermissionAllowed`'s role-permission check — visibility governs *whether the
 * project can be viewed at all*, while that helper governs role-scoped actions once access is
 * established. Feed/discovery surfacing of 'global' projects to non-members is CL-726/727 — this
 * helper only covers direct access (fetching a specific project by id).
 */
export const canViewProject = async (
	ctx: Ctx,
	projectId: Id<'projects'>,
	authUserId: string
): Promise<boolean> => {
	const project = await ctx.db.get(projectId);
	if (!project) {
		return false;
	}

	if (project.visibility === 'global') {
		return true;
	}

	const profile = await getProfileByAuthUserId(ctx, authUserId);
	if (!profile) {
		return false;
	}

	const memberships = await ctx.db
		.query('projectMembers')
		.withIndex('by_project_and_profile', (q) =>
			q.eq('projectId', projectId).eq('profileId', profile._id)
		)
		.collect();
	if (memberships.length > 0) {
		// Includes left/done members: they were once part of the project and should not lose
		// visibility into a project they contributed to just because it's club-restricted.
		return true;
	}

	const attributedClubIds = await listAttributedClubIds(ctx, projectId);
	for (const clubId of attributedClubIds) {
		const clubMemberships = await ctx.db
			.query('clubMembers')
			.withIndex('by_club_and_profile', (q) => q.eq('clubId', clubId).eq('profileId', profile._id))
			.collect();
		if (clubMemberships.some((membership) => !membership.leftAt)) {
			return true;
		}
	}

	const pendingInvites = await ctx.db
		.query('projectInvites')
		.withIndex('by_project_and_invitee', (q) =>
			q.eq('projectId', projectId).eq('inviteeProfileId', profile._id)
		)
		.collect();
	// CL-722: a pending invitee can view the project (to decide via the invite banner)
	// even if they're not yet a member of an attributed club.
	if (pendingInvites.some((invite) => invite.status === 'pending')) {
		return true;
	}

	return false;
};

/**
 * CL-722/PRD 6.6.2 "smart defaults" applied to invite/join-request acceptance: when a user
 * becomes a project member, auto-create their attribution rows only for the UNAMBIGUOUS
 * overlap - clubs that are BOTH already attributed to the project AND clubs the new member is
 * CURRENTLY in. If that overlap is empty (no shared club, or the new member is in no clubs),
 * no attribution is created; the member can always link one manually afterward via `linkClub`.
 */
export const applyAttributionOverlapOnJoin = async (
	ctx: MutationCtx,
	projectId: Id<'projects'>,
	newMemberProfileId: Id<'profiles'>
): Promise<void> => {
	const attributedClubIds = await listAttributedClubIds(ctx, projectId);
	if (attributedClubIds.length === 0) return;

	const now = Date.now();
	for (const clubId of attributedClubIds) {
		const clubMembership = await getMembershipByProfileId(ctx, clubId, newMemberProfileId);
		if (!clubMembership) continue;

		const existing = await ctx.db
			.query('projectAttributions')
			.withIndex('by_project_and_profile_and_club', (q) =>
				q.eq('projectId', projectId).eq('profileId', newMemberProfileId).eq('clubId', clubId)
			)
			.unique();
		if (existing) continue;

		await ctx.db.insert('projectAttributions', {
			projectId,
			profileId: newMemberProfileId,
			clubId,
			createdAt: now
		});
	}
};
