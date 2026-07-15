import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { getRelatedProfile, listMembershipsForProfile, requireIdentity, requireProfile } from './permissions';
import { canViewProject } from './projectsModel';

type Ctx = QueryCtx | MutationCtx;

const COMMENT_MAX_LENGTH = 1000;

// PRD 6.14.4 (CL-730): single source of truth for "is this comment hidden by an admin takedown",
// mirroring `updates.ts`'s `isUpdateVisible`.
const isCommentVisible = (comment: Pick<Doc<'updateComments'>, 'takedown'>): boolean =>
	!comment.takedown;

/**
 * PRD 6.7.4: commenting requires >=1 ACTIVE club membership (any club — not necessarily one
 * attributed to the update's project). A user with zero clubs cannot comment anywhere.
 */
const hasActiveClubMembership = async (ctx: Ctx, profile: Doc<'profiles'>) => {
	const memberships = await listMembershipsForProfile(ctx, profile);
	return memberships.some((membership) => !membership.leftAt);
};

/**
 * PRD 6.7.4: viewing an update's comments is gated the same way as viewing the update itself —
 * whoever can see the update (via `updates.listByProject`/`listForViewer`/`listGlobal`, all of
 * which are themselves gated by `canViewProject` or attribution-derived club membership) can
 * read its comments. This intentionally does NOT re-check "is this project still global /
 * still attributed to one of my clubs" beyond what `canViewProject` already encodes, so existing
 * comments remain visible to anyone who can currently see the update — only *posting new*
 * comments is time-gated (see `addComment`).
 */
const canViewUpdate = async (ctx: Ctx, update: Doc<'updates'>, authUserId: string) => {
	if (!update.projectId) return false;
	return await canViewProject(ctx, update.projectId, authUserId);
};

export const listComments = query({
	args: {
		updateId: v.id('updates')
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const update = await ctx.db.get(args.updateId);
		if (!update) {
			throw new ConvexError('Update not found');
		}

		const allowed = await canViewUpdate(ctx, update, identity.subject);
		if (!allowed) {
			throw new ConvexError('Permission denied');
		}

		// PRD 6.14.4 (CL-730): taken-down comments disappear from the comments list.
		const comments = (
			await ctx.db
				.query('updateComments')
				.withIndex('by_update_and_created', (q) => q.eq('updateId', args.updateId))
				.order('asc')
				.collect()
		).filter((comment) => isCommentVisible(comment));

		const authorCache = new Map<Id<'profiles'>, Doc<'profiles'> | null>();
		const withAuthor = async (comment: Doc<'updateComments'>) => {
			let author = authorCache.get(comment.authorProfileId);
			if (author === undefined) {
				author = await getRelatedProfile(ctx, comment.authorProfileId);
				authorCache.set(comment.authorProfileId, author);
			}
			const name =
				[author?.firstName ?? '', author?.lastName ?? ''].join(' ').trim() ||
				author?.username ||
				'Unknown';
			return {
				commentId: comment._id,
				updateId: comment.updateId,
				content: comment.content,
				createdAt: comment.createdAt,
				authorProfileId: comment.authorProfileId,
				authorName: name,
				authorImageAssetId: author?.profileImageMediaAssetId ?? null
			};
		};

		return await Promise.all(comments.map(withAuthor));
	}
});

export const countComments = query({
	args: {
		updateId: v.id('updates')
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const update = await ctx.db.get(args.updateId);
		if (!update) {
			return 0;
		}

		const allowed = await canViewUpdate(ctx, update, identity.subject);
		if (!allowed) {
			return 0;
		}

		const comments = await ctx.db
			.query('updateComments')
			.withIndex('by_update', (q) => q.eq('updateId', args.updateId))
			.collect();
		// PRD 6.14.4 (CL-730): taken-down comments don't count.
		return comments.filter((comment) => isCommentVisible(comment)).length;
	}
});

// UI-gating helper: lets the composer hide/disable itself before the user attempts to submit,
// rather than surfacing `addComment`'s ConvexError only after a failed round-trip. Mirrors
// `addComment`'s own eligibility checks exactly.
export const canComment = query({
	args: {
		updateId: v.id('updates')
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const profile = await requireProfile(ctx, identity.subject);

		const update = await ctx.db.get(args.updateId);
		if (!update) return false;

		const eligible = await hasActiveClubMembership(ctx, profile);
		if (!eligible) return false;

		return await canViewUpdate(ctx, update, identity.subject);
	}
});

export const addComment = mutation({
	args: {
		updateId: v.id('updates'),
		content: v.string()
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const profile = await requireProfile(ctx, identity.subject);

		const update = await ctx.db.get(args.updateId);
		if (!update) {
			throw new ConvexError('Update not found');
		}

		// PRD 6.7.4: eligibility to POST is checked at comment time — >=1 active club membership
		// AND current ability to view the update's project. This is what makes "global -> clubs"
		// visibility flips naturally stop new outside comments (canViewProject re-evaluates against
		// the project's current visibility/attribution) while past comments are left untouched
		// (this mutation never deletes or re-validates existing rows).
		const eligible = await hasActiveClubMembership(ctx, profile);
		if (!eligible) {
			throw new ConvexError('You need to be an active member of a club to comment.');
		}

		const allowed = await canViewUpdate(ctx, update, identity.subject);
		if (!allowed) {
			throw new ConvexError('Permission denied');
		}

		const trimmedContent = args.content.trim();
		if (!trimmedContent) {
			throw new ConvexError('Comment text is required.');
		}
		if (trimmedContent.length > COMMENT_MAX_LENGTH) {
			throw new ConvexError(`Comments must be ${COMMENT_MAX_LENGTH} characters or fewer.`);
		}

		const now = Date.now();
		const commentId = await ctx.db.insert('updateComments', {
			updateId: args.updateId,
			authorProfileId: profile._id,
			content: trimmedContent,
			createdAt: now
		});

		return await ctx.db.get(commentId);
	}
});
