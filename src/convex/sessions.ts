import { ConvexError, v } from 'convex/values';
import { internal } from './_generated/api';
import { internalMutation, mutation, query } from './_generated/server';
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
import { dispatchNotification } from './notificationsModel';

type Ctx = QueryCtx | MutationCtx;

const rsvpStatusValidator = v.union(v.literal('going'), v.literal('not_going'));
const attendanceStatusValidator = v.union(v.literal('present'), v.literal('absent'));

const HOUR_MS = 60 * 60 * 1000;
const SESSION_PHOTO_POST_SESSION_WINDOW_MS = 12 * HOUR_MS;
const ATTENDANCE_LOCK_WINDOW_MS = 12 * HOUR_MS;
const ATTENDANCE_REMINDER_DELAY_MS = HOUR_MS;
const SESSION_REMINDER_LEAD_MS = 24 * HOUR_MS;
const MAX_SESSION_PHOTOS = 4;

const getRsvpForSessionAndProfile = async (
	ctx: Ctx,
	sessionId: Id<'sessions'>,
	profileId: Id<'profiles'>
) => {
	return await ctx.db
		.query('sessionRsvps')
		.withIndex('by_session_and_profile', (q) =>
			q.eq('sessionId', sessionId).eq('profileId', profileId)
		)
		.unique();
};

const getRsvpCounts = async (ctx: Ctx, sessionId: Id<'sessions'>) => {
	const rows = await ctx.db
		.query('sessionRsvps')
		.withIndex('by_session', (q) => q.eq('sessionId', sessionId))
		.collect();
	let going = 0;
	let notGoing = 0;
	for (const row of rows) {
		if (row.status === 'going') going += 1;
		else notGoing += 1;
	}
	return { going, notGoing };
};

const getSession = async (ctx: Ctx, sessionId: Id<'sessions'>) => {
	const session = await ctx.db.get(sessionId);
	if (!session) {
		throw new ConvexError('Session not found');
	}
	return session;
};

const requireAttendanceWindowOpen = (session: {
	startTime: number;
	endTime: number;
	cancelled?: boolean;
}) => {
	if (session.cancelled) {
		throw new ConvexError('Cannot mark attendance for a cancelled session');
	}
	const now = Date.now();
	if (now < session.startTime) {
		throw new ConvexError('Attendance opens when the session starts');
	}
	if (now > session.endTime + ATTENDANCE_LOCK_WINDOW_MS) {
		throw new ConvexError('Attendance is locked for this session');
	}
};

// Roster snapshot: members who were part of the club at the session's start time,
// i.e. joined at/before startTime and (still active OR left after startTime).
const getRosterAtSessionStart = async (ctx: Ctx, clubId: Id<'clubs'>, startTime: number) => {
	const members = await ctx.db
		.query('clubMembers')
		.withIndex('by_club', (q) => q.eq('clubId', clubId))
		.collect();

	return members.filter(
		(member) => member.createdAt <= startTime && (!member.leftAt || member.leftAt > startTime)
	);
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
		if (row.status !== 'present') continue;
		if (attendees.length >= limit) break;

		const profile = await getRelatedProfile(ctx, row.profileId);
		if (!profile) continue;
		const authUserId = getProfileAuthUserId(profile);
		const fullName = [profile?.firstName, profile?.lastName].filter(Boolean).join(' ').trim();
		const name = fullName || profile.username || authUserId || 'Member';
		attendees.push({
			name,
			imageUrl: null,
			profileImageMediaAssetId: profile?.profileImageMediaAssetId ?? null
		});
	}

	return attendees;
};

type AttendanceRosterEntry = {
	profileId: Id<'profiles'>;
	userId: string;
	firstName: string | null;
	lastName: string | null;
	username: string | null;
	profileImageMediaAssetId: Id<'mediaAssets'> | null;
	status: 'present' | 'absent' | null;
	// True when this person has an attendance record but is no longer in the roster snapshot
	// (e.g. they left the club after the session but before the sheet was viewed again).
	isPastMember: boolean;
};

// Combines the roster snapshot (who was in the club at session start) with any recorded
// attendance rows, so the UI can render "not yet recorded" vs present/absent per person.
// Also surfaces attendance records for people the roster snapshot doesn't include (defensive:
// keeps historical records visible even if the snapshot logic or data ever diverges).
const getAttendanceRoster = async (
	ctx: Ctx,
	session: { _id: Id<'sessions'>; clubId: Id<'clubs'>; startTime: number }
): Promise<AttendanceRosterEntry[]> => {
	const rosterMembers = await getRosterAtSessionStart(ctx, session.clubId, session.startTime);
	const attendanceRows = await ctx.db
		.query('attendances')
		.withIndex('by_session', (q) => q.eq('sessionId', session._id))
		.collect();
	const attendanceByProfileId = new Map(attendanceRows.map((row) => [row.profileId, row] as const));

	const entries: AttendanceRosterEntry[] = [];
	const seenProfileIds = new Set<Id<'profiles'>>();

	for (const member of rosterMembers) {
		const profile = await getRelatedProfile(ctx, member.profileId);
		if (!profile) continue;
		seenProfileIds.add(member.profileId);
		const attendance = attendanceByProfileId.get(member.profileId);
		entries.push({
			profileId: profile._id,
			userId: getProfileAuthUserId(profile),
			firstName: member.firstName ?? profile.firstName ?? null,
			lastName: member.lastName ?? profile.lastName ?? null,
			username: member.username ?? profile.username ?? null,
			profileImageMediaAssetId: profile.profileImageMediaAssetId ?? null,
			status: attendance?.status ?? null,
			isPastMember: false
		});
	}

	for (const row of attendanceRows) {
		if (seenProfileIds.has(row.profileId)) continue;
		const profile = await getRelatedProfile(ctx, row.profileId);
		entries.push({
			profileId: row.profileId,
			userId: profile ? getProfileAuthUserId(profile) : 'unknown',
			firstName: profile?.firstName ?? null,
			lastName: profile?.lastName ?? null,
			username: profile?.username ?? null,
			profileImageMediaAssetId: profile?.profileImageMediaAssetId ?? null,
			status: row.status,
			isPastMember: true
		});
	}

	return entries;
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

		const sessions = args.limit
			? await queryBuilder.take(args.limit * 2 + 10)
			: await queryBuilder.collect();
		const visible = sessions.filter((session) => !session.cancelled);
		return args.limit ? visible.slice(0, args.limit) : visible;
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
				const attendance = await ctx.db
					.query('attendances')
					.withIndex('by_session_and_profile', (q) =>
						q.eq('sessionId', session._id).eq('profileId', profile._id)
					)
					.unique();
				if (attendance?.status === 'present') {
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

// Cancels any previously scheduled "attendance unmarked" reminder for a session and, if the
// (possibly new) startTime is still in the future, schedules a fresh one for startTime + 1h.
// Scheduling only ever targets future sessions: existing past sessions are never backfilled.
const rescheduleAttendanceReminder = async (
	ctx: MutationCtx,
	sessionId: Id<'sessions'>,
	existingJobId: Id<'_scheduled_functions'> | undefined,
	startTime: number,
	options: { cancelledOnly?: boolean } = {}
) => {
	if (existingJobId) {
		try {
			await ctx.scheduler.cancel(existingJobId);
		} catch {
			// Job may have already run or been cancelled; ignore.
		}
	}

	if (options.cancelledOnly || startTime <= Date.now()) {
		await ctx.db.patch(sessionId, { attendanceReminderJobId: undefined });
		return;
	}

	const jobId = await ctx.scheduler.runAt(
		startTime + ATTENDANCE_REMINDER_DELAY_MS,
		internal.sessions.sendAttendanceReminderIfUnmarked,
		{ sessionId }
	);
	await ctx.db.patch(sessionId, { attendanceReminderJobId: jobId });
};

// Cancels any previously scheduled 24h member-facing session reminder and, if the (possibly
// new) startTime is more than 24h away, schedules a fresh one for startTime - 24h. Sessions
// created or moved to less than 24h ahead get no reminder (the member just saw the session;
// an immediate reminder would be noise).
const rescheduleSessionReminder = async (
	ctx: MutationCtx,
	sessionId: Id<'sessions'>,
	existingJobId: Id<'_scheduled_functions'> | undefined,
	startTime: number,
	options: { cancelledOnly?: boolean } = {}
) => {
	if (existingJobId) {
		try {
			await ctx.scheduler.cancel(existingJobId);
		} catch {
			// Job may have already run or been cancelled; ignore.
		}
	}

	const reminderTime = startTime - SESSION_REMINDER_LEAD_MS;
	if (options.cancelledOnly || reminderTime <= Date.now()) {
		await ctx.db.patch(sessionId, { sessionReminderJobId: undefined });
		return;
	}

	const jobId = await ctx.scheduler.runAt(reminderTime, internal.sessions.sendSessionReminder, {
		sessionId
	});
	await ctx.db.patch(sessionId, { sessionReminderJobId: jobId });
};

export const create = mutation({
	args: {
		clubId: v.id('clubs'),
		startTime: v.number(),
		endTime: v.number(),
		description: v.optional(v.string()),
		location: v.optional(v.string())
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
			location: args.location,
			createdByProfileId: profile._id,
			createdAt: now,
			updatedAt: now
		});

		await rescheduleAttendanceReminder(ctx, sessionId, undefined, args.startTime);
		await rescheduleSessionReminder(ctx, sessionId, undefined, args.startTime);

		return await ctx.db.get(sessionId);
	}
});

export const update = mutation({
	args: {
		sessionId: v.id('sessions'),
		startTime: v.number(),
		endTime: v.number(),
		description: v.optional(v.string()),
		location: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const session = await getSession(ctx, args.sessionId);
		await requirePermission(ctx, session.clubId, identity.subject, 'session:update');

		if (session.cancelled) {
			throw new ConvexError('Cannot update a cancelled session');
		}
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
			location: args.location,
			updatedAt: Date.now()
		});

		if (session.startTime !== args.startTime) {
			await rescheduleAttendanceReminder(
				ctx,
				args.sessionId,
				session.attendanceReminderJobId,
				args.startTime
			);
			await rescheduleSessionReminder(
				ctx,
				args.sessionId,
				session.sessionReminderJobId,
				args.startTime
			);
		}

		return await ctx.db.get(args.sessionId);
	}
});

export const cancel = mutation({
	args: {
		sessionId: v.id('sessions')
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const profile = await requireProfile(ctx, identity.subject);
		const session = await getSession(ctx, args.sessionId);
		await requirePermission(ctx, session.clubId, identity.subject, 'session:cancel');

		if (session.cancelled) {
			throw new ConvexError('Session is already cancelled');
		}
		if (session.startTime < Date.now()) {
			throw new ConvexError('Only future sessions can be cancelled');
		}

		const now = Date.now();
		await ctx.db.patch(args.sessionId, {
			cancelled: true,
			cancelledAt: now,
			cancelledByProfileId: profile._id,
			updatedAt: now
		});

		await rescheduleAttendanceReminder(
			ctx,
			args.sessionId,
			session.attendanceReminderJobId,
			session.startTime,
			{ cancelledOnly: true }
		);
		await rescheduleSessionReminder(
			ctx,
			args.sessionId,
			session.sessionReminderJobId,
			session.startTime,
			{ cancelledOnly: true }
		);

		const club = await ctx.db.get(session.clubId);
		const rsvps = await ctx.db
			.query('sessionRsvps')
			.withIndex('by_session', (q) => q.eq('sessionId', args.sessionId))
			.collect();
		const sessionDateLabel = new Date(session.startTime).toLocaleDateString(undefined, {
			weekday: 'short',
			month: 'short',
			day: 'numeric'
		});
		for (const rsvp of rsvps) {
			if (rsvp.status !== 'going') continue;
			await dispatchNotification(ctx, {
				recipientProfileId: rsvp.profileId,
				kind: 'session_cancelled',
				clubId: session.clubId,
				title: 'Session cancelled',
				message: `Session on ${sessionDateLabel} at ${club?.name ?? 'your club'} was cancelled.`,
				url: `/session/${args.sessionId}/activities`
			});
		}

		return await ctx.db.get(args.sessionId);
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
		const profile = await requireProfile(ctx, identity.subject);
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

		const rsvpCounts = await getRsvpCounts(ctx, args.sessionId);
		const myRsvp = await getRsvpForSessionAndProfile(ctx, args.sessionId, profile._id);

		return { tagNames, attendees, rsvpCounts, myRsvpStatus: myRsvp?.status ?? null };
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
		const profile = await requireProfile(ctx, identity.subject);
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
		const rawSessions = args.limit
			? await queryBuilder.take(args.limit * 2 + 10)
			: await queryBuilder.collect();
		const visibleSessions = rawSessions.filter((session) => !session.cancelled);
		const sessions = args.limit ? visibleSessions.slice(0, args.limit) : visibleSessions;

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
			// PRD 6.16 (CL-731): full activity-name list (activityItems is capped at 3 for card
			// display) so the sessions page can search by activity name client-side.
			allActivityNames: string[];
			hiddenActivitiesCount: number;
			rsvpCounts: { going: number; notGoing: number };
			myRsvpStatus: 'going' | 'not_going' | null;
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

			const rsvpCounts = await getRsvpCounts(ctx, session._id);
			const myRsvp = await getRsvpForSessionAndProfile(ctx, session._id, profile._id);

			entries.push({
				session,
				tagNames,
				attendees,
				activityItems,
				allActivityNames: activities.map((activity) => activity.name),
				hiddenActivitiesCount: Math.max(activities.length - activityItems.length, 0),
				rsvpCounts,
				myRsvpStatus: myRsvp?.status ?? null
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

// Roster snapshot (people who were in the club at session start) merged with any recorded
// attendance status. `status` is null when attendance hasn't been recorded for that person yet.
export const listAttendanceRoster = query({
	args: {
		sessionId: v.id('sessions')
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const session = await getSession(ctx, args.sessionId);
		await requirePermission(ctx, session.clubId, identity.subject, 'attendance:read');

		return await getAttendanceRoster(ctx, session);
	}
});

export const setAttendance = mutation({
	args: {
		sessionId: v.id('sessions'),
		profileId: v.id('profiles'),
		status: attendanceStatusValidator
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const session = await getSession(ctx, args.sessionId);
		await requirePermission(ctx, session.clubId, identity.subject, 'attendance:create');
		requireAttendanceWindowOpen(session);

		const targetProfile = await ctx.db.get(args.profileId);
		if (!targetProfile) {
			throw new ConvexError('Profile not found');
		}

		const roster = await getRosterAtSessionStart(ctx, session.clubId, session.startTime);
		if (!roster.some((member) => member.profileId === args.profileId)) {
			throw new ConvexError('Attendee was not a club member when the session started');
		}

		const recorderProfile = await requireProfile(ctx, identity.subject);
		const existing = await ctx.db
			.query('attendances')
			.withIndex('by_session_and_profile', (q) =>
				q.eq('sessionId', args.sessionId).eq('profileId', args.profileId)
			)
			.unique();

		const now = Date.now();
		if (existing) {
			await ctx.db.patch(existing._id, {
				status: args.status,
				recordedByProfileId: recorderProfile._id,
				recordedAt: now
			});
		} else {
			await ctx.db.insert('attendances', {
				sessionId: args.sessionId,
				profileId: args.profileId,
				status: args.status,
				recordedByProfileId: recorderProfile._id,
				recordedAt: now
			});
		}

		return { success: true };
	}
});

// Internal: checks whether attendance was recorded for a session ~1 hour after it started,
// and if not (and the session isn't cancelled), notifies every Guide of the club.
export const sendAttendanceReminderIfUnmarked = internalMutation({
	args: {
		sessionId: v.id('sessions')
	},
	handler: async (ctx, args) => {
		const session = await ctx.db.get(args.sessionId);
		if (!session || session.cancelled) return;

		const existingAttendance = await ctx.db
			.query('attendances')
			.withIndex('by_session', (q) => q.eq('sessionId', args.sessionId))
			.first();
		if (existingAttendance) return;

		const members = await ctx.db
			.query('clubMembers')
			.withIndex('by_club', (q) => q.eq('clubId', session.clubId))
			.collect();

		const sessionDateLabel = new Date(session.startTime).toLocaleDateString(undefined, {
			weekday: 'short',
			month: 'short',
			day: 'numeric'
		});

		for (const member of members) {
			if (member.leftAt) continue;
			const role = await ctx.db.get(member.roleId);
			if (role?.key !== 'guide') continue;

			await dispatchNotification(ctx, {
				recipientProfileId: member.profileId,
				kind: 'attendance_reminder',
				clubId: session.clubId,
				title: 'Attendance not recorded',
				message: `Attendance for the session on ${sessionDateLabel} hasn't been recorded yet.`,
				url: `/session/${args.sessionId}/attendees`
			});
		}
	}
});

// Internal: 24h-before-start reminder for all active club members (scheduled via
// rescheduleSessionReminder). Skips cancelled sessions and respects the sessionReminder
// preference (enforced inside dispatchNotification).
export const sendSessionReminder = internalMutation({
	args: {
		sessionId: v.id('sessions')
	},
	handler: async (ctx, args) => {
		const session = await ctx.db.get(args.sessionId);
		if (!session || session.cancelled) return;
		if (session.startTime <= Date.now()) return;

		const club = await ctx.db.get(session.clubId);
		const sessionDateLabel = new Date(session.startTime).toLocaleDateString(undefined, {
			weekday: 'short',
			month: 'short',
			day: 'numeric'
		});
		const sessionTimeLabel = new Date(session.startTime).toLocaleTimeString(undefined, {
			hour: '2-digit',
			minute: '2-digit'
		});

		const members = await ctx.db
			.query('clubMembers')
			.withIndex('by_club', (q) => q.eq('clubId', session.clubId))
			.collect();
		for (const member of members) {
			if (member.leftAt) continue;
			await dispatchNotification(ctx, {
				recipientProfileId: member.profileId,
				kind: 'session_reminder',
				clubId: session.clubId,
				title: 'Session tomorrow',
				message: `Session at ${club?.name ?? 'your club'} starts ${sessionDateLabel} at ${sessionTimeLabel}.`,
				url: `/session/${args.sessionId}/activities`
			});
		}
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

export const setRsvp = mutation({
	args: {
		sessionId: v.id('sessions'),
		status: rsvpStatusValidator
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const profile = await requireProfile(ctx, identity.subject);
		const session = await getSession(ctx, args.sessionId);
		await requirePermission(ctx, session.clubId, identity.subject, 'session_rsvp:set');

		if (!(await getMembershipByProfileId(ctx, session.clubId, profile._id))) {
			throw new ConvexError('Must be an active club member to RSVP');
		}
		if (session.cancelled) {
			throw new ConvexError('Cannot RSVP to a cancelled session');
		}
		if (session.startTime <= Date.now()) {
			throw new ConvexError('RSVP is locked once the session has started');
		}

		const existing = await getRsvpForSessionAndProfile(ctx, args.sessionId, profile._id);
		const now = Date.now();
		if (existing) {
			await ctx.db.patch(existing._id, { status: args.status, updatedAt: now });
			return await ctx.db.get(existing._id);
		}

		const rsvpId = await ctx.db.insert('sessionRsvps', {
			sessionId: args.sessionId,
			profileId: profile._id,
			status: args.status,
			createdAt: now,
			updatedAt: now
		});
		return await ctx.db.get(rsvpId);
	}
});

export const listRsvps = query({
	args: {
		sessionId: v.id('sessions')
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const session = await getSession(ctx, args.sessionId);
		await requirePermission(ctx, session.clubId, identity.subject, 'session_rsvp:read_all');

		const rows = await ctx.db
			.query('sessionRsvps')
			.withIndex('by_session', (q) => q.eq('sessionId', args.sessionId))
			.collect();

		const output: Array<{
			profileId: Id<'profiles'>;
			status: 'going' | 'not_going';
			firstName: string | null;
			lastName: string | null;
			username: string | null;
		}> = [];

		for (const row of rows) {
			const profile = await getRelatedProfile(ctx, row.profileId);
			if (!profile) continue;
			output.push({
				profileId: profile._id,
				status: row.status,
				firstName: profile.firstName ?? null,
				lastName: profile.lastName ?? null,
				username: profile.username ?? null
			});
		}

		return output;
	}
});

const isSessionPhotoUploadWindowOpen = (session: { startTime: number; endTime: number }) => {
	const now = Date.now();
	return now >= session.startTime && now <= session.endTime + SESSION_PHOTO_POST_SESSION_WINDOW_MS;
};

const requireOwnedReadySessionPhotoAsset = async (
	ctx: MutationCtx,
	userId: string,
	assetId: Id<'mediaAssets'>
) => {
	const asset = await ctx.db.get(assetId);
	if (!asset || asset.ownerUserId !== userId) {
		throw new ConvexError('Photo upload not found');
	}
	if (asset.status !== 'ready') {
		throw new ConvexError('Photo is not ready yet');
	}
	if (asset.mediaKind !== 'image') {
		throw new ConvexError('Session photos must be images');
	}

	return asset;
};

export const listPhotos = query({
	args: {
		sessionId: v.id('sessions')
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const session = await getSession(ctx, args.sessionId);
		await requirePermission(ctx, session.clubId, identity.subject, 'session:read');

		const profile = await requireProfile(ctx, identity.subject);
		const canUploadPermission = await hasPermission(
			ctx,
			session.clubId,
			identity.subject,
			'session_photo:create'
		);
		const windowOpen = !session.cancelled && isSessionPhotoUploadWindowOpen(session);

		const rows = await ctx.db
			.query('sessionPhotos')
			.withIndex('by_session', (q) => q.eq('sessionId', args.sessionId))
			.collect();

		const sorted = rows.sort((a, b) => a.createdAt - b.createdAt);

		return await Promise.all(
			sorted.map(async (row) => {
				const asset = await ctx.db.get(row.mediaAssetId);
				return {
					sessionPhotoId: row._id,
					mediaAssetId: row.mediaAssetId,
					uploadedByProfileId: row.uploadedByProfileId,
					createdAt: row.createdAt,
					canDelete:
						canUploadPermission && windowOpen && profile._id === row.uploadedByProfileId,
					assetStatus: asset?.status ?? null,
					mediaKind: asset?.mediaKind ?? null,
					contentType: asset?.contentType ?? null,
					durationSeconds: asset?.durationSeconds ?? null,
					storageProvider: asset?.storageProvider ?? null,
					deliveryBucket: asset ? (asset.processedBucket ?? asset.sourceBucket ?? null) : null,
					deliveryObjectKey: asset
						? (asset.processedObjectKey ?? asset.sourceObjectKey ?? null)
						: null
				};
			})
		);
	}
});

export const canUploadSessionPhoto = query({
	args: {
		sessionId: v.id('sessions')
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const session = await getSession(ctx, args.sessionId);
		const allowed = await hasPermission(
			ctx,
			session.clubId,
			identity.subject,
			'session_photo:create'
		);
		if (!allowed || session.cancelled) {
			return false;
		}

		return isSessionPhotoUploadWindowOpen(session);
	}
});

export const addPhoto = mutation({
	args: {
		sessionId: v.id('sessions'),
		mediaAssetId: v.id('mediaAssets')
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const profile = await requireProfile(ctx, identity.subject);
		const session = await getSession(ctx, args.sessionId);
		await requirePermission(ctx, session.clubId, identity.subject, 'session_photo:create');

		if (session.cancelled) {
			throw new ConvexError('Cannot add photos to a cancelled session');
		}
		if (!isSessionPhotoUploadWindowOpen(session)) {
			throw new ConvexError(
				'Photos can only be added during the session or within 12 hours after it ends'
			);
		}

		const existing = await ctx.db
			.query('sessionPhotos')
			.withIndex('by_session', (q) => q.eq('sessionId', args.sessionId))
			.collect();
		if (existing.length >= MAX_SESSION_PHOTOS) {
			throw new ConvexError(`A session can have at most ${MAX_SESSION_PHOTOS} photos`);
		}

		await requireOwnedReadySessionPhotoAsset(ctx, identity.subject, args.mediaAssetId);

		const sessionPhotoId = await ctx.db.insert('sessionPhotos', {
			sessionId: args.sessionId,
			mediaAssetId: args.mediaAssetId,
			uploadedByProfileId: profile._id,
			createdAt: Date.now()
		});

		return await ctx.db.get(sessionPhotoId);
	}
});

export const deletePhoto = mutation({
	args: {
		sessionPhotoId: v.id('sessionPhotos')
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const profile = await requireProfile(ctx, identity.subject);
		const photo = await ctx.db.get(args.sessionPhotoId);
		if (!photo) {
			throw new ConvexError('Photo not found');
		}

		const session = await getSession(ctx, photo.sessionId);
		await requirePermission(ctx, session.clubId, identity.subject, 'session_photo:create');

		if (photo.uploadedByProfileId !== profile._id) {
			throw new ConvexError('Only the uploading guide can remove this photo');
		}
		if (session.cancelled) {
			throw new ConvexError('Cannot modify photos on a cancelled session');
		}
		if (!isSessionPhotoUploadWindowOpen(session)) {
			throw new ConvexError('Photos can no longer be modified for this session');
		}

		await ctx.db.delete(args.sessionPhotoId);
		return { success: true };
	}
});

export const getSessionPhotoDeliveryAssets = query({
	args: {
		sessionId: v.id('sessions'),
		assetIds: v.array(v.id('mediaAssets'))
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const session = await getSession(ctx, args.sessionId);
		await requirePermission(ctx, session.clubId, identity.subject, 'session:read');

		const requestedAssetIds = [...new Set(args.assetIds)];
		if (!requestedAssetIds.length) {
			return [];
		}

		const photos = await ctx.db
			.query('sessionPhotos')
			.withIndex('by_session', (q) => q.eq('sessionId', args.sessionId))
			.collect();
		const allowedAssetIds = new Set(photos.map((photo) => photo.mediaAssetId));

		const deliveryAssets = await Promise.all(
			requestedAssetIds
				.filter((assetId) => allowedAssetIds.has(assetId))
				.map(async (assetId) => {
					const asset = await ctx.db.get(assetId);
					if (!asset || asset.status !== 'ready' || asset.mediaKind !== 'image') {
						return null;
					}

					return {
						assetId: asset._id,
						storageProvider: asset.storageProvider,
						deliveryBucket: asset.processedBucket ?? asset.sourceBucket ?? null,
						deliveryObjectKey: asset.processedObjectKey ?? asset.sourceObjectKey ?? null,
						mediaKind: asset.mediaKind ?? null,
						contentType: asset.contentType ?? null,
						durationSeconds: asset.durationSeconds ?? null
					};
				})
		);

		return deliveryAssets.filter(Boolean);
	}
});

// One-time backfill for the CL-719 attendance model change: legacy `attendances` rows only
// existed for members marked present (checkbox semantics), so every pre-existing row becomes
// status: 'present', recordedBy/recordedAt derived from the old createdByProfileId/createdAt.
// Run once via `npx convex run sessions:backfillAttendanceStatus` after deploying the schema change.
export const backfillAttendanceStatus = internalMutation({
	args: {},
	handler: async (ctx) => {
		const rows = await ctx.db.query('attendances').collect();
		let updated = 0;
		for (const row of rows) {
			const legacyRow = row as unknown as {
				status?: 'present' | 'absent';
				recordedByProfileId?: Id<'profiles'>;
				recordedAt?: number;
				createdByProfileId?: Id<'profiles'>;
				createdAt?: number;
			};
			const hasLegacyFields = legacyRow.createdAt !== undefined || legacyRow.createdByProfileId !== undefined;
			const isFullyMigrated =
				legacyRow.status && legacyRow.recordedByProfileId && legacyRow.recordedAt && !hasLegacyFields;
			if (isFullyMigrated) continue;
			// Use replace (not patch) so legacy fields like createdAt/createdByProfileId are
			// dropped rather than left dangling as extra fields once the schema is tightened.
			await ctx.db.replace(row._id, {
				sessionId: row.sessionId,
				profileId: row.profileId,
				status: legacyRow.status ?? 'present',
				recordedByProfileId: legacyRow.recordedByProfileId ?? legacyRow.createdByProfileId ?? row.profileId,
				recordedAt: legacyRow.recordedAt ?? legacyRow.createdAt ?? Date.now()
			});
			updated += 1;
		}
		return { updated, total: rows.length };
	}
});
