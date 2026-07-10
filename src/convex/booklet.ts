import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { requireGlobalAdmin, requireIdentity, requirePermission, requireProfile } from './permissions';

export const listActivities = query({
	args: {},
	handler: async (ctx) => {
		await requireIdentity(ctx);

		const activities = await ctx.db.query('bookletActivities').collect();
		const allLinks = await ctx.db.query('bookletActivityBuildingBlocks').collect();
		const allBlocks = await ctx.db.query('buildingBlocks').collect();
		const blockById = new Map(allBlocks.map((b) => [b._id, b.name] as const));

		const linksByActivity = new Map<Id<'bookletActivities'>, Id<'buildingBlocks'>[]>();
		for (const link of allLinks) {
			const list = linksByActivity.get(link.activityId) ?? [];
			list.push(link.buildingBlockId);
			linksByActivity.set(link.activityId, list);
		}

		return activities.map((activity) => {
			const blockIds = linksByActivity.get(activity._id) ?? [];
			return {
				_id: activity._id,
				name: activity.name ?? '',
				content: activity.content ?? null,
				minutes: activity.minutes ?? null,
				status: activity.status ?? null,
				buildingBlockIds: blockIds,
				buildingBlockNames: blockIds
					.map((id) => blockById.get(id))
					.filter((name): name is string => Boolean(name))
			};
		});
	}
});

export const getActivity = query({
	args: {
		activityId: v.id('bookletActivities')
	},
	handler: async (ctx, args) => {
		await requireIdentity(ctx);

		const activity = await ctx.db.get(args.activityId);
		if (!activity) {
			throw new ConvexError('Booklet activity not found');
		}

		const links = await ctx.db
			.query('bookletActivityBuildingBlocks')
			.withIndex('by_activity', (q) => q.eq('activityId', args.activityId))
			.collect();

		const blockIds = links.map((l) => l.buildingBlockId);
		const blocks = await ctx.db.query('buildingBlocks').collect();
		const blockById = new Map(blocks.map((b) => [b._id, b.name] as const));

		return {
			_id: activity._id,
			name: activity.name ?? '',
			content: activity.content ?? null,
			minutes: activity.minutes ?? null,
			status: activity.status ?? null,
			createdAt: activity.createdAt,
			buildingBlockIds: blockIds,
			buildingBlockNames: blockIds
				.map((id) => blockById.get(id))
				.filter((name): name is string => Boolean(name))
		};
	}
});

export const addToSession = mutation({
	args: {
		bookletActivityId: v.id('bookletActivities'),
		sessionId: v.id('sessions')
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const profile = await requireProfile(ctx, identity.subject);

		const session = await ctx.db.get(args.sessionId);
		if (!session) {
			throw new ConvexError('Session not found');
		}
		await requirePermission(ctx, session.clubId, identity.subject, 'session_activity:create');

		const bookletActivity = await ctx.db.get(args.bookletActivityId);
		if (!bookletActivity) {
			throw new ConvexError('Booklet activity not found');
		}

		const now = Date.now();
		const sessionActivityId = await ctx.db.insert('sessionActivities', {
			sessionId: args.sessionId,
			name: bookletActivity.name ?? 'Untitled Activity',
			content: bookletActivity.content,
			minutes: bookletActivity.minutes,
			bookletActivityId: args.bookletActivityId,
			createdByProfileId: profile._id,
			createdAt: now,
			updatedAt: now
		});

		// Copy building block links
		const bookletLinks = await ctx.db
			.query('bookletActivityBuildingBlocks')
			.withIndex('by_activity', (q) => q.eq('activityId', args.bookletActivityId))
			.collect();

		for (const link of bookletLinks) {
			await ctx.db.insert('sessionActivityBuildingBlocks', {
				sessionActivityId,
				sessionId: args.sessionId,
				buildingBlockId: link.buildingBlockId,
				createdAt: now
			});
		}

		return await ctx.db.get(sessionActivityId);
	}
});

// ---------------------------------------------------------------------------
// Admin-gated curation surface (PRD 6.14.5/6.14.6, CL-701). Every export below calls
// requireGlobalAdmin first, following the admin.ts template.
//
// Deletion note: `adminDeleteActivity` removes the `bookletActivities` row and its
// `bookletActivityBuildingBlocks` link rows. This is safe for existing session copies because
// `addToSession` (above) COPIES the activity's name/content/minutes and building-block links onto
// new `sessionActivities`/`sessionActivityBuildingBlocks` rows at add-time — it stores
// `bookletActivityId` only as a soft back-reference for provenance, never re-reads through it.
// Deleting the source booklet activity therefore leaves every session's copy fully intact.
// ---------------------------------------------------------------------------

export const adminListActivities = query({
	args: {},
	handler: async (ctx) => {
		await requireGlobalAdmin(ctx);

		const activities = await ctx.db.query('bookletActivities').collect();
		const allLinks = await ctx.db.query('bookletActivityBuildingBlocks').collect();
		const allBlocks = await ctx.db.query('buildingBlocks').collect();
		const blockById = new Map(allBlocks.map((b) => [b._id, b.name] as const));

		const linksByActivity = new Map<Id<'bookletActivities'>, Id<'buildingBlocks'>[]>();
		for (const link of allLinks) {
			const list = linksByActivity.get(link.activityId) ?? [];
			list.push(link.buildingBlockId);
			linksByActivity.set(link.activityId, list);
		}

		return activities.map((activity) => {
			const blockIds = linksByActivity.get(activity._id) ?? [];
			return {
				_id: activity._id,
				name: activity.name ?? '',
				content: activity.content ?? null,
				minutes: activity.minutes ?? null,
				status: activity.status ?? null,
				createdAt: activity.createdAt,
				buildingBlockIds: blockIds,
				buildingBlockNames: blockIds
					.map((id) => blockById.get(id))
					.filter((name): name is string => Boolean(name))
			};
		});
	}
});

export const adminCreateActivity = mutation({
	args: {
		name: v.string(),
		content: v.optional(v.string()),
		minutes: v.optional(v.number()),
		buildingBlockIds: v.array(v.id('buildingBlocks'))
	},
	handler: async (ctx, args) => {
		const identity = await requireGlobalAdmin(ctx);
		const profile = await requireProfile(ctx, identity.subject);

		const now = Date.now();
		const activityId = await ctx.db.insert('bookletActivities', {
			name: args.name,
			content: args.content,
			minutes: args.minutes,
			createdByProfileId: profile._id,
			createdAt: now,
			updatedAt: now
		});

		for (const buildingBlockId of args.buildingBlockIds) {
			await ctx.db.insert('bookletActivityBuildingBlocks', {
				activityId,
				buildingBlockId
			});
		}

		return activityId;
	}
});

export const adminUpdateActivity = mutation({
	args: {
		activityId: v.id('bookletActivities'),
		name: v.string(),
		content: v.optional(v.string()),
		minutes: v.optional(v.number()),
		buildingBlockIds: v.array(v.id('buildingBlocks'))
	},
	handler: async (ctx, args) => {
		await requireGlobalAdmin(ctx);

		const activity = await ctx.db.get(args.activityId);
		if (!activity) {
			throw new ConvexError('Booklet activity not found');
		}

		await ctx.db.patch(args.activityId, {
			name: args.name,
			content: args.content,
			minutes: args.minutes,
			updatedAt: Date.now()
		});

		const existingLinks = await ctx.db
			.query('bookletActivityBuildingBlocks')
			.withIndex('by_activity', (q) => q.eq('activityId', args.activityId))
			.collect();
		for (const link of existingLinks) {
			await ctx.db.delete(link._id);
		}
		for (const buildingBlockId of args.buildingBlockIds) {
			await ctx.db.insert('bookletActivityBuildingBlocks', {
				activityId: args.activityId,
				buildingBlockId
			});
		}

		return null;
	}
});

export const adminDeleteActivity = mutation({
	args: {
		activityId: v.id('bookletActivities')
	},
	handler: async (ctx, args) => {
		await requireGlobalAdmin(ctx);

		const activity = await ctx.db.get(args.activityId);
		if (!activity) {
			throw new ConvexError('Booklet activity not found');
		}

		// Session copies are unaffected — addToSession forks the activity's fields onto
		// sessionActivities/sessionActivityBuildingBlocks rows rather than referencing this
		// activity live, so deleting it here does not touch any existing session's activities.
		const links = await ctx.db
			.query('bookletActivityBuildingBlocks')
			.withIndex('by_activity', (q) => q.eq('activityId', args.activityId))
			.collect();
		for (const link of links) {
			await ctx.db.delete(link._id);
		}

		await ctx.db.delete(args.activityId);
		return null;
	}
});

export const adminListBuildingBlocks = query({
	args: {},
	handler: async (ctx) => {
		await requireGlobalAdmin(ctx);
		return await ctx.db.query('buildingBlocks').collect();
	}
});

export const adminCreateBuildingBlock = mutation({
	args: {
		name: v.string(),
		description: v.optional(v.string()),
		slug: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		await requireGlobalAdmin(ctx);
		return await ctx.db.insert('buildingBlocks', {
			name: args.name,
			description: args.description,
			slug: args.slug,
			createdAt: Date.now()
		});
	}
});
