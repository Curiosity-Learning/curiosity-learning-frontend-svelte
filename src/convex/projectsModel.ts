import { ConvexError } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { getProfileByAuthUserId } from './permissions';

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

export const insertProjectChangeLog = async (
	ctx: MutationCtx,
	args: {
		projectId: Id<'projects'>;
		actorProfileId: Id<'profiles'> | null;
		entryType:
			| 'member_joined'
			| 'member_done'
			| 'member_left'
			| 'project_archived';
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
