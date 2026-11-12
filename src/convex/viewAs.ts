import { ConvexError, v } from 'convex/values';
import type { Doc } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { internalMutation, internalQuery, query } from './_generated/server';
import { parentScopedMutation } from './functions';
import {
	getIdentitySessionId,
	getProfileByAuthUserId,
	getRealIdentity,
	requireNotSuspended,
	requireRealIdentity,
	resolveViewingAsChild
} from './permissions';

// Parent "View as Child" (CL-801): switching a parent's session into (and out of) viewing the
// app as a linked child. Everything here works on the parent's REAL identity; the swap itself
// lives in permissions.ts (`getViewerIdentity`) and the write refusal in functions.ts. Starting a
// view writes only the parent's own `parentViewSessions` row; it never acts as the child.

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

/** For public actions (no database): whether the caller's session is viewing as a child. */
export const isCallerViewingAsChild = internalQuery({
	args: {},
	returns: v.boolean(),
	handler: async (ctx) => {
		const identity = await getRealIdentity(ctx);
		if (!identity) return false;
		return (await resolveViewingAsChild(ctx, identity)) !== null;
	}
});

/**
 * Everything the "View as" bar needs: the caller's linked children (empty for anyone who is not
 * a parent) and which one this session is viewing as, if any.
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

export const startViewing = parentScopedMutation({
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

		for (const row of await getSessionRows(ctx, identity.subject, sessionId)) {
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

export const stopViewing = parentScopedMutation({
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

// A view row outlives nothing useful once its login session is gone, and no session lasts longer
// than 30 days (auth.ts REMEMBERED_SESSION_SECONDS). Cleared by the daily maintenance cron.
export const STALE_VIEW_SESSION_MS = 31 * 24 * 60 * 60 * 1000;
const STALE_PAGE_SIZE = 200;

export const deleteStaleViewSessions = internalMutation({
	args: {},
	returns: v.object({ deleted: v.number(), hasMore: v.boolean() }),
	handler: async (ctx) => {
		const stale = await ctx.db
			.query('parentViewSessions')
			.withIndex('by_started_at', (q) => q.lt('startedAt', Date.now() - STALE_VIEW_SESSION_MS))
			.take(STALE_PAGE_SIZE + 1);
		const page = stale.slice(0, STALE_PAGE_SIZE);
		for (const row of page) await ctx.db.delete(row._id);
		return { deleted: page.length, hasMore: stale.length > STALE_PAGE_SIZE };
	}
});
