import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server';
import type { Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import {
	getMembershipByProfileId,
	getProfileAuthUserId,
	getRelatedProfile,
	hasPermission,
	listMembershipsForProfile,
	requireIdentity,
	requirePermission,
	requireProfile
} from './permissions';

type Ctx = QueryCtx | MutationCtx;

const getSession = async (ctx: Ctx, sessionId: Id<'sessions'>) => {
	const session = await ctx.db.get(sessionId);
	if (!session) {
		throw new ConvexError('Session not found');
	}
	return session;
};

const getSessionAttendeePreviews = async (ctx: Ctx, sessionId: Id<'sessions'>, limit = 6) => {
	const attendanceRows = await ctx.db
		.query('attendances')
		.withIndex('by_session', (q) => q.eq('sessionId', sessionId))
		.collect();
	const attendees: Array<{
		name: string;
		imageUrl: string | null;
		profileImageMediaAssetId: Id<'mediaAssets'> | null;
	}> = [];

	for (const row of attendanceRows) {
		if (attendees.length >= limit) break;

		const profile = await getRelatedProfile(ctx, row.profileId, row.userId);
		const authUserId = profile ? getProfileAuthUserId(profile) : row.userId;
		const fullName = [profile?.firstName, profile?.lastName].filter(Boolean).join(' ').trim();
		const name = profile ? fullName || profile.username || authUserId || 'Member' : 'Past member';
		attendees.push({
			name,
			imageUrl: null,
			profileImageMediaAssetId: profile?.profileImageMediaAssetId ?? null
		});
	}

	return attendees;
};

const getSessionAttendanceAttendees = async (ctx: Ctx, sessionId: Id<'sessions'>) => {
	const attendanceRows = await ctx.db
		.query('attendances')
		.withIndex('by_session', (q) => q.eq('sessionId', sessionId))
		.collect();
	const attendees: Array<{
		profileId: Id<'profiles'> | null;
		userId: string;
		firstName: string | null;
		lastName: string | null;
		username: string | null;
		profileImageMediaAssetId: Id<'mediaAssets'> | null;
		isPastMember: boolean;
	}> = [];

	for (const row of attendanceRows) {
		const profile = await getRelatedProfile(ctx, row.profileId, row.userId);
		const authUserId = profile ? getProfileAuthUserId(profile) : row.userId;
		if (!authUserId) continue;

		attendees.push({
			profileId: profile?._id ?? null,
			userId: authUserId,
			firstName: profile?.firstName ?? null,
			lastName: profile?.lastName ?? null,
			username: profile?.username ?? null,
			profileImageMediaAssetId: profile?.profileImageMediaAssetId ?? null,
			isPastMember: !profile
		});
	}

	return attendees;
};

export const listByClub = query({
	args: {
		clubId: v.id('clubs'),
		upcomingOnly: v.optional(v.boolean()),
		limit: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		await requirePermission(ctx, args.clubId, identity.subject, 'session:read');

		const now = Date.now();
		const queryBuilder = ctx.db.query('sessions').withIndex('by_club_and_start', (q) => {
			const base = q.eq('clubId', args.clubId);
			return args.upcomingOnly ? base.gte('startTime', now) : base;
		});

		if (args.limit) {
			return await queryBuilder.take(args.limit);
		}
		return await queryBuilder.collect();
	}
});

export const countAttendedForViewer = query({
	args: {},
	handler: async (ctx) => {
		const identity = await requireIdentity(ctx);
		const profile = await requireProfile(ctx, identity.subject);
		const memberships = await listMembershipsForProfile(ctx, profile);
		const activeMemberships = memberships.filter((membership) => !membership.leftAt);

		let count = 0;
		for (const membership of activeMemberships) {
			if (!(await hasPermission(ctx, membership.clubId, identity.subject, 'session:read'))) {
				continue;
			}

			const sessions = await ctx.db
				.query('sessions')
				.withIndex('by_club', (q) => q.eq('clubId', membership.clubId))
				.collect();

			for (const session of sessions) {
				const attendance =
					(await ctx.db
						.query('attendances')
						.withIndex('by_session_and_profile', (q) =>
							q.eq('sessionId', session._id).eq('profileId', profile._id)
						)
						.unique()) ??
					(await ctx.db
						.query('attendances')
						.withIndex('by_session_and_user', (q) =>
							q.eq('sessionId', session._id).eq('userId', identity.subject)
						)
						.unique());
				if (attendance) {
					count += 1;
				}
			}
		}

		return count;
	}
});

export const getById = query({
	args: {
		sessionId: v.id('sessions')
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const session = await getSession(ctx, args.sessionId);
		await requirePermission(ctx, session.clubId, identity.subject, 'session:read');

		return session;
	}
});

export const create = mutation({
	args: {
		clubId: v.id('clubs'),
		startTime: v.number(),
		endTime: v.number(),
		description: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const profile = await requireProfile(ctx, identity.subject);
		await requirePermission(ctx, args.clubId, identity.subject, 'session:create');

		if (args.endTime <= args.startTime) {
			throw new ConvexError('End time must be after start time');
		}

		const now = Date.now();
		const sessionId = await ctx.db.insert('sessions', {
			clubId: args.clubId,
			startTime: args.startTime,
			endTime: args.endTime,
			description: args.description,
			createdByProfileId: profile._id,
			createdAt: now,
			updatedAt: now
		});

		return await ctx.db.get(sessionId);
	}
});

export const update = mutation({
	args: {
		sessionId: v.id('sessions'),
		startTime: v.number(),
		endTime: v.number(),
		description: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const session = await getSession(ctx, args.sessionId);
		await requirePermission(ctx, session.clubId, identity.subject, 'session:update');

		if (session.startTime < Date.now()) {
			throw new ConvexError('Cannot update past sessions');
		}
		if (args.endTime <= args.startTime) {
			throw new ConvexError('End time must be after start time');
		}

		await ctx.db.patch(args.sessionId, {
			startTime: args.startTime,
			endTime: args.endTime,
			description: args.description,
			updatedAt: Date.now()
		});

		return await ctx.db.get(args.sessionId);
	}
});

export const remove = mutation({
	args: {
		sessionId: v.id('sessions')
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const session = await getSession(ctx, args.sessionId);
		await requirePermission(ctx, session.clubId, identity.subject, 'session:delete');

		const activities = await ctx.db
			.query('sessionActivities')
			.withIndex('by_session', (q) => q.eq('sessionId', args.sessionId))
			.collect();
		for (const activity of activities) {
			const links = await ctx.db
				.query('sessionActivityBuildingBlocks')
				.withIndex('by_session_activity', (q) => q.eq('sessionActivityId', activity._id))
				.collect();
			for (const link of links) {
				await ctx.db.delete(link._id);
			}
			await ctx.db.delete(activity._id);
		}

		const attendance = await ctx.db
			.query('attendances')
			.withIndex('by_session', (q) => q.eq('sessionId', args.sessionId))
			.collect();
		for (const row of attendance) {
			await ctx.db.delete(row._id);
		}

		await ctx.db.delete(args.sessionId);
		return { success: true };
	}
});

export const listActivities = query({
	args: {
		sessionId: v.id('sessions')
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const session = await getSession(ctx, args.sessionId);
		await requirePermission(ctx, session.clubId, identity.subject, 'session_activity:read');

		const rawActivities = await ctx.db
			.query('sessionActivities')
			.withIndex('by_session', (q) => q.eq('sessionId', args.sessionId))
			.collect();
		const activities = rawActivities.sort(
			(a, b) => (a.order ?? a._creationTime) - (b.order ?? b._creationTime)
		);

		// Fast path (newer data): fetch all links for this session in one query.
		const sessionLinks = await ctx.db
			.query('sessionActivityBuildingBlocks')
			.withIndex('by_session', (q) => q.eq('sessionId', args.sessionId))
			.collect();
		const blocksByActivityId = new Map<Id<'sessionActivities'>, Id<'buildingBlocks'>[]>();
		if (sessionLinks.length) {
			for (const link of sessionLinks) {
				const list = blocksByActivityId.get(link.sessionActivityId) ?? [];
				list.push(link.buildingBlockId);
				blocksByActivityId.set(link.sessionActivityId, list);
			}
		}

		const payload = [] as Array<{
			id: (typeof activities)[number]['_id'];
			name: string;
			slug: string | null;
			content: string | null;
			minutes: number | null;
			buildingBlocks: Id<'buildingBlocks'>[];
		}>;

		for (const activity of activities) {
			const links = blocksByActivityId.get(activity._id) ?? [];
			payload.push({
				id: activity._id,
				name: activity.name,
				slug: activity.slug ?? null,
				content: activity.content ?? null,
				minutes: activity.minutes ?? null,
				buildingBlocks: links
			});
		}

		return payload;
	}
});

export const getSessionCardData = query({
	args: {
		sessionId: v.id('sessions'),
		includeAttendees: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const session = await getSession(ctx, args.sessionId);

		// Tags come from activities/building blocks.
		await requirePermission(ctx, session.clubId, identity.subject, 'session_activity:read');

		const buildingBlockIds = new Set<Id<'buildingBlocks'>>();
		const sessionLinks = await ctx.db
			.query('sessionActivityBuildingBlocks')
			.withIndex('by_session', (q) => q.eq('sessionId', args.sessionId))
			.collect();

		for (const link of sessionLinks) {
			buildingBlockIds.add(link.buildingBlockId);
		}

		const blocks = await ctx.db.query('buildingBlocks').collect();
		const blockById = new Map(blocks.map((b) => [b._id, b.name] as const));
		const tagNames = Array.from(buildingBlockIds)
			.map((id) => blockById.get(id))
			.filter((name): name is string => Boolean(name))
			.slice(0, 3);

		const attendees: Array<{
			name: string;
			imageUrl: string | null;
			profileImageMediaAssetId: Id<'mediaAssets'> | null;
		}> = [];
		if (args.includeAttendees) {
			const canReadAttendance = await hasPermission(
				ctx,
				session.clubId,
				identity.subject,
				'attendance:read'
			);
			const canReadMembers = await hasPermission(
				ctx,
				session.clubId,
				identity.subject,
				'club_member:read_active'
			);
			if (canReadAttendance && canReadMembers) {
				attendees.push(...(await getSessionAttendeePreviews(ctx, args.sessionId)));
			}
		}

		return { tagNames, attendees };
	}
});

export const listCardPreviewsByClub = query({
	args: {
		clubId: v.id('clubs'),
		upcomingOnly: v.optional(v.boolean()),
		limit: v.optional(v.number()),
		includeAttendees: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		// Single payload for session cards so list/dashboard routes avoid nested per-card queries.
		const identity = await requireIdentity(ctx);
		await requirePermission(ctx, args.clubId, identity.subject, 'session:read');
		const canReadActivities = await hasPermission(
			ctx,
			args.clubId,
			identity.subject,
			'session_activity:read'
		);

		const now = Date.now();
		const queryBuilder = ctx.db.query('sessions').withIndex('by_club_and_start', (q) => {
			const base = q.eq('clubId', args.clubId);
			return args.upcomingOnly ? base.gte('startTime', now) : base;
		});
		const sessions = args.limit
			? await queryBuilder.take(args.limit)
			: await queryBuilder.collect();

		if (sessions.length === 0) return [];

		const blocks = await ctx.db.query('buildingBlocks').collect();
		const blockById = new Map(blocks.map((block) => [block._id, block.name] as const));

		const includeAttendees = Boolean(args.includeAttendees);
		let canReadAttendance = false;
		let canReadMembers = false;
		if (includeAttendees) {
			canReadAttendance = await hasPermission(
				ctx,
				args.clubId,
				identity.subject,
				'attendance:read'
			);
			canReadMembers = await hasPermission(
				ctx,
				args.clubId,
				identity.subject,
				'club_member:read_active'
			);
		}

		const entries: Array<{
			session: (typeof sessions)[number];
			tagNames: string[];
			attendees: Array<{
				name: string;
				imageUrl: string | null;
				profileImageMediaAssetId: Id<'mediaAssets'> | null;
			}>;
			activityItems: Array<{ id: string; title: string; description: string | null }>;
			hiddenActivitiesCount: number;
		}> = [];

		for (const session of sessions) {
			const rawActivities = canReadActivities
				? await ctx.db
						.query('sessionActivities')
						.withIndex('by_session', (q) => q.eq('sessionId', session._id))
						.collect()
				: [];
			const activities = rawActivities.sort(
				(a, b) => (a.order ?? a._creationTime) - (b.order ?? b._creationTime)
			);

			const activityItems = activities.slice(0, 3).map((activity) => ({
				id: String(activity._id),
				title: activity.name,
				description: activity.content ?? null
			}));

			const links = canReadActivities
				? await ctx.db
						.query('sessionActivityBuildingBlocks')
						.withIndex('by_session', (q) => q.eq('sessionId', session._id))
						.collect()
				: [];
			const buildingBlockIds = new Set<Id<'buildingBlocks'>>();
			for (const link of links) {
				buildingBlockIds.add(link.buildingBlockId);
			}
			const tagNames = Array.from(buildingBlockIds)
				.map((id) => blockById.get(id))
				.filter((name): name is string => Boolean(name))
				.slice(0, 3);

			const attendees: Array<{
				name: string;
				imageUrl: string | null;
				profileImageMediaAssetId: Id<'mediaAssets'> | null;
			}> = [];
			if (includeAttendees && canReadAttendance && canReadMembers) {
				attendees.push(...(await getSessionAttendeePreviews(ctx, session._id)));
			}

			entries.push({
				session,
				tagNames,
				attendees,
				activityItems,
				hiddenActivitiesCount: Math.max(activities.length - activityItems.length, 0)
			});
		}

		return entries;
	}
});

export const upsertActivity = mutation({
	args: {
		sessionId: v.id('sessions'),
		activityId: v.optional(v.id('sessionActivities')),
		name: v.string(),
		slug: v.optional(v.string()),
		content: v.optional(v.string()),
		minutes: v.optional(v.number()),
		buildingBlockIds: v.optional(v.array(v.id('buildingBlocks')))
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const profile = await requireProfile(ctx, identity.subject);
		const session = await getSession(ctx, args.sessionId);
		const permission = args.activityId ? 'session_activity:update' : 'session_activity:create';
		await requirePermission(ctx, session.clubId, identity.subject, permission);

		const now = Date.now();
		let activityId = args.activityId;
		if (activityId) {
			const activity = await ctx.db.get(activityId);
			if (!activity || activity.sessionId !== args.sessionId) {
				throw new ConvexError('Activity does not belong to this session');
			}
			await ctx.db.patch(activityId, {
				name: args.name,
				slug: args.slug,
				content: args.content,
				minutes: args.minutes,
				updatedAt: now
			});
		} else {
			activityId = await ctx.db.insert('sessionActivities', {
				sessionId: args.sessionId,
				name: args.name,
				slug: args.slug,
				content: args.content,
				minutes: args.minutes,
				createdByProfileId: profile._id,
				createdAt: now,
				updatedAt: now
			});
		}

		if (args.buildingBlockIds) {
			const links = await ctx.db
				.query('sessionActivityBuildingBlocks')
				.withIndex('by_session_activity', (q) => q.eq('sessionActivityId', activityId))
				.collect();
			for (const link of links) {
				await ctx.db.delete(link._id);
			}
			for (const buildingBlockId of args.buildingBlockIds) {
				await ctx.db.insert('sessionActivityBuildingBlocks', {
					sessionActivityId: activityId,
					sessionId: args.sessionId,
					buildingBlockId,
					createdAt: now
				});
			}
		} else {
			// Opportunistic backfill: if this activity already has link records without sessionId, patch them.
			const links = await ctx.db
				.query('sessionActivityBuildingBlocks')
				.withIndex('by_session_activity', (q) => q.eq('sessionActivityId', activityId))
				.collect();
			for (const link of links) {
				if (link.sessionId) continue;
				await ctx.db.patch(link._id, { sessionId: args.sessionId });
			}
		}

		return await ctx.db.get(activityId);
	}
});

export const deleteActivity = mutation({
	args: {
		activityId: v.id('sessionActivities')
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const activity = await ctx.db.get(args.activityId);
		if (!activity) {
			throw new ConvexError('Activity not found');
		}

		const session = await getSession(ctx, activity.sessionId);
		await requirePermission(ctx, session.clubId, identity.subject, 'session_activity:delete');

		const links = await ctx.db
			.query('sessionActivityBuildingBlocks')
			.withIndex('by_session_activity', (q) => q.eq('sessionActivityId', args.activityId))
			.collect();
		for (const link of links) {
			await ctx.db.delete(link._id);
		}

		await ctx.db.delete(args.activityId);
		return { success: true };
	}
});

export const reorderActivities = mutation({
	args: {
		sessionId: v.id('sessions'),
		activityIds: v.array(v.id('sessionActivities'))
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const session = await getSession(ctx, args.sessionId);
		await requirePermission(ctx, session.clubId, identity.subject, 'session_activity:update');

		const now = Date.now();
		for (let i = 0; i < args.activityIds.length; i++) {
			const activityId = args.activityIds[i];
			const activity = await ctx.db.get(activityId);
			if (!activity || activity.sessionId !== args.sessionId) {
				throw new ConvexError('Activity does not belong to this session');
			}
			await ctx.db.patch(activityId, {
				order: i,
				updatedAt: now
			});
		}

		return { success: true };
	}
});

export const listBuildingBlocks = query({
	args: {},
	handler: async (ctx) => {
		await requireIdentity(ctx);
		return await ctx.db.query('buildingBlocks').collect();
	}
});

export const listAttendance = query({
	args: {
		sessionId: v.id('sessions')
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const session = await getSession(ctx, args.sessionId);
		await requirePermission(ctx, session.clubId, identity.subject, 'attendance:read');

		const rows = await ctx.db
			.query('attendances')
			.withIndex('by_session', (q) => q.eq('sessionId', args.sessionId))
			.collect();
		return await Promise.all(
			rows.map(async (row) => {
				const profile = await getRelatedProfile(ctx, row.profileId, row.userId);
				return {
					...row,
					profileId: profile?._id ?? row.profileId ?? null,
					userId: profile ? getProfileAuthUserId(profile) : row.userId
				};
			})
		);
	}
});

export const listAttendanceAttendees = query({
	args: {
		sessionId: v.id('sessions')
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const session = await getSession(ctx, args.sessionId);
		await requirePermission(ctx, session.clubId, identity.subject, 'attendance:read');

		return await getSessionAttendanceAttendees(ctx, args.sessionId);
	}
});

export const setAttendance = mutation({
	args: {
		sessionId: v.id('sessions'),
		profileId: v.id('profiles'),
		attending: v.boolean()
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const session = await getSession(ctx, args.sessionId);
		await requirePermission(ctx, session.clubId, identity.subject, 'attendance:create');
		const targetProfile = await ctx.db.get(args.profileId);
		if (!targetProfile) {
			throw new ConvexError('Profile not found');
		}
		if (!(await getMembershipByProfileId(ctx, session.clubId, args.profileId))) {
			throw new ConvexError('Attendee must be an active club member');
		}
		const creatorProfile = await requireProfile(ctx, identity.subject);

		const existing =
			(await ctx.db
				.query('attendances')
				.withIndex('by_session_and_profile', (q) =>
					q.eq('sessionId', args.sessionId).eq('profileId', args.profileId)
				)
				.unique()) ??
			(await ctx.db
				.query('attendances')
				.withIndex('by_session_and_user', (q) =>
					q.eq('sessionId', args.sessionId).eq('userId', getProfileAuthUserId(targetProfile) ?? '')
				)
				.unique());

		if (args.attending) {
			if (!existing) {
				await ctx.db.insert('attendances', {
					sessionId: args.sessionId,
					profileId: args.profileId,
					createdByProfileId: creatorProfile._id,
					createdAt: Date.now()
				});
			}
		} else if (existing) {
			await ctx.db.delete(existing._id);
		}

		return { success: true };
	}
});

export const canManageSession = query({
	args: {
		clubId: v.id('clubs')
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		return await hasPermission(ctx, args.clubId, identity.subject, 'session:update');
	}
});
