import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { requireIdentity, hasPermission, requirePermission } from './permissions';
import { dayOfWeekValidator, isEndTimeAfterStartTime, isValidTimeString } from './scheduleModel';

const normalizeLocation = (value: string) => value.trim();

const validateSlotFields = (startTime: string, endTime: string, location: string) => {
	if (!isValidTimeString(startTime) || !isValidTimeString(endTime)) {
		throw new ConvexError('Times must be in HH:MM 24-hour format');
	}
	if (!isEndTimeAfterStartTime(startTime, endTime)) {
		throw new ConvexError('End time must be after start time');
	}
	if (!normalizeLocation(location)) {
		throw new ConvexError('Location is required');
	}
};

export const listByClub = query({
	args: {
		clubId: v.id('clubs')
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const canRead = await hasPermission(ctx, args.clubId, identity.subject, 'club:read');
		if (!canRead) {
			throw new ConvexError('Permission denied');
		}

		return await ctx.db
			.query('clubScheduleSlots')
			.withIndex('by_club', (q) => q.eq('clubId', args.clubId))
			.collect();
	}
});

export const create = mutation({
	args: {
		clubId: v.id('clubs'),
		dayOfWeek: dayOfWeekValidator,
		startTime: v.string(),
		endTime: v.string(),
		location: v.string()
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		await requirePermission(ctx, args.clubId, identity.subject, 'club:edit');

		validateSlotFields(args.startTime, args.endTime, args.location);

		const now = Date.now();
		const slotId = await ctx.db.insert('clubScheduleSlots', {
			clubId: args.clubId,
			dayOfWeek: args.dayOfWeek,
			startTime: args.startTime,
			endTime: args.endTime,
			location: normalizeLocation(args.location),
			createdAt: now,
			updatedAt: now
		});

		return await ctx.db.get(slotId);
	}
});

export const update = mutation({
	args: {
		slotId: v.id('clubScheduleSlots'),
		dayOfWeek: dayOfWeekValidator,
		startTime: v.string(),
		endTime: v.string(),
		location: v.string()
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const slot = await ctx.db.get(args.slotId);
		if (!slot) {
			throw new ConvexError('Schedule slot not found');
		}
		await requirePermission(ctx, slot.clubId, identity.subject, 'club:edit');

		validateSlotFields(args.startTime, args.endTime, args.location);

		await ctx.db.patch(args.slotId, {
			dayOfWeek: args.dayOfWeek,
			startTime: args.startTime,
			endTime: args.endTime,
			location: normalizeLocation(args.location),
			updatedAt: Date.now()
		});

		return await ctx.db.get(args.slotId);
	}
});

export const remove = mutation({
	args: {
		slotId: v.id('clubScheduleSlots')
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const slot = await ctx.db.get(args.slotId);
		if (!slot) {
			throw new ConvexError('Schedule slot not found');
		}
		await requirePermission(ctx, slot.clubId, identity.subject, 'club:edit');

		await ctx.db.delete(args.slotId);
		return { success: true };
	}
});
