import { ConvexError, v } from 'convex/values';
import type { Doc } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { internalQuery, mutation, query } from './_generated/server';
import {
	getIdentitySessionId,
	getProfileByAuthUserId,
	getRealIdentity,
	requireNotSuspended,
	requireRealIdentity,
	resolveViewingAsChild
} from './permissions';

// CL-734 "View as Child": switching a parent's session into (and out of) viewing the app as a
// linked child. Every function here works on the parent's REAL identity — the swap itself lives
// in permissions.ts (`getViewerIdentity`). Starting a view writes only the parent's own
// `parentViewSessions` row; it never acts as the child.

const childSummaryValidator = v.object({
	childProfileId: v.id('profiles'),
	displayName: v.string(),
	username: v.union(v.string(), v.null()),
	coverPhotoUrl: v.union(v.string(), v.null())
});

const childDisplayName = (child: Doc<'profiles'>) =>
	[child.firstName, child.lastName].filter(Boolean).join(' ').trim() ||
	child.username ||
	'Your child';

const getSessionRows = async (ctx: MutationCtx, parentAuthUserId: string, sessionId: string) =>
	await ctx.db
		.query('parentViewSessions')
		.withIndex('by_parent_auth_user_and_session', (q) =>
			q.eq('parentAuthUserId', parentAuthUserId).eq('sessionId', sessionId)
		)
		.collect();

/** Used by actions (no db) to learn whether the caller is viewing as a child. */
export const getViewingAsForCaller = internalQuery({
	args: {},
	returns: v.boolean(),
	handler: async (ctx) => {
		const identity = await getRealIdentity(ctx);
		if (!identity) return false;
		return (await resolveViewingAsChild(ctx, identity)) !== null;
	}
});

/**
 * Everything the "View as" banner needs: the caller's linked children (empty for anyone who is
 * not a parent) and which one this session is viewing as, if any.
 */
export const getState = query({
	args: {},
	returns: v.object({
		children: v.array(childSummaryValidator),
		viewingAsChildProfileId: v.union(v.id('profiles'), v.null())
	}),
	handler: async (ctx) => {
		const identity = await getRealIdentity(ctx);
		if (!identity) return { children: [], viewingAsChildProfileId: null };
		const parentProfile = await getProfileByAuthUserId(ctx, identity.subject);
		if (!parentProfile) return { children: [], viewingAsChildProfileId: null };

		const links = await ctx.db
			.query('parentLinks')
			.withIndex('by_parent', (q) => q.eq('parentProfileId', parentProfile._id))
			.collect();
		const children = [];
		for (const link of links) {
			const child = await ctx.db.get(link.childProfileId);
			if (!child) continue;
			children.push({
				childProfileId: child._id,
				displayName: childDisplayName(child),
				username: child.username ?? null,
				coverPhotoUrl: child.coverPhotoUrl ?? null
			});
		}
		const viewing = await resolveViewingAsChild(ctx, identity);
		return { children, viewingAsChildProfileId: viewing?.childProfileId ?? null };
	}
});

export const startViewing = mutation({
	args: { childProfileId: v.id('profiles') },
	returns: v.null(),
	handler: async (ctx, args) => {
		const identity = await requireRealIdentity(ctx);
		const parentProfile = await getProfileByAuthUserId(ctx, identity.subject);
		if (!parentProfile) {
			throw new ConvexError('Profile not found');
		}
		requireNotSuspended(parentProfile);
		const link = await ctx.db
			.query('parentLinks')
			.withIndex('by_parent_and_child', (q) =>
				q.eq('parentProfileId', parentProfile._id).eq('childProfileId', args.childProfileId)
			)
			.first();
		if (!link) {
			throw new ConvexError('You do not have access to this child account');
		}
		const sessionId = getIdentitySessionId(identity);
		if (!sessionId) {
			throw new ConvexError('Sign in again to view as your child');
		}

		const existing = await getSessionRows(ctx, identity.subject, sessionId);
		for (const row of existing) {
			await ctx.db.delete(row._id);
		}
		await ctx.db.insert('parentViewSessions', {
			parentAuthUserId: identity.subject,
			sessionId,
			parentProfileId: parentProfile._id,
			childProfileId: args.childProfileId,
			startedAt: Date.now()
		});
		return null;
	}
});

export const stopViewing = mutation({
	args: {},
	returns: v.null(),
	handler: async (ctx) => {
		const identity = await requireRealIdentity(ctx);
		const sessionId = getIdentitySessionId(identity);
		if (!sessionId) return null;
		for (const row of await getSessionRows(ctx, identity.subject, sessionId)) {
			await ctx.db.delete(row._id);
		}
		return null;
	}
});
