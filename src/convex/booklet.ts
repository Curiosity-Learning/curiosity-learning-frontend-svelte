import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { requireIdentity, requirePermission, requireProfile } from './permissions';

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
