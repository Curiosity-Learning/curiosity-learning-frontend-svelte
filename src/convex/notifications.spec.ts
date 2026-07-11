import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

const HOUR = 60 * 60 * 1000;

// Deliverable-address stubs: the betterAuth component is not available in convex-test, so the
// auth-email lookup module is mocked with a fixed authUserId -> email map.
const { sendEmailMock, authEmailByUserId } = vi.hoisted(() => ({
	sendEmailMock: vi.fn(async () => {}),
	authEmailByUserId: new Map<string, string>([
		['guide-user', 'guide@example.com'],
		['learner-user', 'learner@example.com'],
		['child-user', 'kiddo@children.curiosity.local'],
		['newbie-user', 'newbie@example.com']
	])
}));

vi.mock('./email/resend', () => ({
	sendEmail: sendEmailMock
}));

vi.mock('./authEmail', () => ({
	getAuthUserEmail: async (_ctx: unknown, authUserId: string) =>
		authEmailByUserId.get(authUserId) ?? null
}));

beforeEach(() => {
	sendEmailMock.mockClear();
});

afterEach(() => {
	vi.useRealTimers();
});

const seedFixture = async () => {
	const t = convexTest(schema, modules);
	const ids = await t.run(async (ctx) => {
		const now = Date.now();
		const memberJoinedAt = now - 30 * 24 * HOUR;
		const guideRoleId = await ctx.db.insert('clubRoles', {
			key: 'guide',
			name: 'Guide',
			permissions: [
				'club:read',
				'club_member:kick',
				'club_member:promote',
				'club_join_request:decide',
				'session:read',
				'session:create',
				'session:update',
				'session:cancel',
				'session_rsvp:set',
				'attendance:read',
				'attendance:create'
			],
			order: 0,
			createdAt: now
		});
		const learnerRoleId = await ctx.db.insert('clubRoles', {
			key: 'learner',
			name: 'Learner',
			permissions: ['club:read', 'session:read', 'session_rsvp:set'],
			order: 1,
			createdAt: now
		});
		const guideProfileId = await ctx.db.insert('profiles', {
			authUserId: 'guide-user',
			firstName: 'Gina',
			lastName: 'Guide',
			isVerified: true,
			firstLoginCompleted: true,
			updatedAt: now
		});
		const learnerProfileId = await ctx.db.insert('profiles', {
			authUserId: 'learner-user',
			firstName: 'Lars',
			lastName: 'Learner',
			isVerified: true,
			firstLoginCompleted: true,
			updatedAt: now
		});
		const childProfileId = await ctx.db.insert('profiles', {
			authUserId: 'child-user',
			username: 'kiddo',
			isVerified: true,
			firstLoginCompleted: true,
			updatedAt: now
		});
		await ctx.db.insert('parentChildConsents', {
			childProfileId,
			parentEmail: 'parent@example.com',
			status: 'approved',
			token: 'token-1',
			approvedAt: now,
			createdAt: now,
			updatedAt: now
		});
		const clubId = await ctx.db.insert('clubs', {
			name: 'Curiosity Club',
			clubCode: 'ABC234',
			discoverable: true,
			createdByProfileId: guideProfileId,
			createdAt: now,
			updatedAt: now
		});
		for (const [profileId, roleId] of [
			[guideProfileId, guideRoleId],
			[learnerProfileId, learnerRoleId],
			[childProfileId, learnerRoleId]
		] as const) {
			await ctx.db.insert('clubMembers', {
				clubId,
				profileId,
				roleId,
				createdAt: memberJoinedAt
			});
		}
		return { clubId, guideProfileId, learnerProfileId, childProfileId };
	});
	return { t, ...ids };
};

const notificationsFor = (
	t: Awaited<ReturnType<typeof seedFixture>>['t'],
	profileId: Id<'profiles'>
) =>
	t.run((ctx) =>
		ctx.db
			.query('notifications')
			.withIndex('by_profile', (q) => q.eq('profileId', profileId))
			.collect()
	);

const setAllPreferencesOff = async (
	t: Awaited<ReturnType<typeof seedFixture>>['t'],
	profileId: Id<'profiles'>,
	overrides: Partial<{
		notificationsEnabled: boolean;
		notificationPreferences: Record<string, boolean>;
	}> = {}
) => {
	await t.run(async (ctx) => {
		await ctx.db.insert('userPreferences', {
			profileId,
			theme: 'system',
			notificationsEnabled: overrides.notificationsEnabled ?? false,
			notificationPreferences: {
				clubMemberChanges: false,
				projectDeadlineReminder: false,
				projectMemberAdded: false,
				projectCompleted: false,
				sessionReminder: false,
				sessionActivityChanges: false,
				updateLikes: false,
				updateComments: false,
				chatMessages: false,
				...(overrides.notificationPreferences ?? {})
			},
			updatedAt: Date.now()
		});
	});
};

const memberIdFor = (
	t: Awaited<ReturnType<typeof seedFixture>>['t'],
	clubId: Id<'clubs'>,
	profileId: Id<'profiles'>
) =>
	t.run(async (ctx) => {
		const member = await ctx.db
			.query('clubMembers')
			.withIndex('by_club_and_profile', (q) => q.eq('clubId', clubId).eq('profileId', profileId))
			.unique();
		if (!member) throw new Error('membership not found');
		return member._id;
	});

describe('notification tier routing', () => {
	it('critical kinds ignore muted preferences and email the adult auth address', async () => {
		vi.useFakeTimers();
		const { t, clubId, learnerProfileId } = await seedFixture();
		await setAllPreferencesOff(t, learnerProfileId);

		const memberId = await memberIdFor(t, clubId, learnerProfileId);
		await t
			.withIdentity({ subject: 'guide-user' })
			.mutation(api.clubs.kickMember, { clubMemberId: memberId, reason: 'Testing' });
		await t.finishAllScheduledFunctions(vi.runAllTimers);

		const notifications = await notificationsFor(t, learnerProfileId);
		expect(notifications).toHaveLength(1);
		expect(notifications[0].title).toBe('Removed from club');

		expect(sendEmailMock).toHaveBeenCalledTimes(1);
		expect(sendEmailMock).toHaveBeenCalledWith(
			expect.objectContaining({
				to: 'learner@example.com',
				type: 'notification',
				subject: 'Removed from club'
			})
		);
	});

	it('high kinds respect the mute preference (no in-app row and no email)', async () => {
		vi.useFakeTimers();
		const { t, clubId, learnerProfileId } = await seedFixture();
		await setAllPreferencesOff(t, learnerProfileId, { notificationsEnabled: true });

		const session = await t.withIdentity({ subject: 'guide-user' }).mutation(api.sessions.create, {
			clubId,
			location: 'Club HQ',
			startTime: Date.now() + 2 * HOUR,
			endTime: Date.now() + 3 * HOUR
		});
		if (!session) throw new Error('session not created');
		await t
			.withIdentity({ subject: 'learner-user' })
			.mutation(api.sessions.setRsvp, { sessionId: session._id, status: 'going' });
		await t
			.withIdentity({ subject: 'guide-user' })
			.mutation(api.sessions.cancel, { sessionId: session._id });
		await t.finishAllScheduledFunctions(vi.runAllTimers);

		const notifications = await notificationsFor(t, learnerProfileId);
		expect(notifications).toHaveLength(0);
		expect(sendEmailMock).not.toHaveBeenCalled();
	});

	it('high kinds send in-app and email by default (no stored preferences)', async () => {
		vi.useFakeTimers();
		const { t, clubId, learnerProfileId } = await seedFixture();

		const session = await t.withIdentity({ subject: 'guide-user' }).mutation(api.sessions.create, {
			clubId,
			location: 'Club HQ',
			startTime: Date.now() + 2 * HOUR,
			endTime: Date.now() + 3 * HOUR
		});
		if (!session) throw new Error('session not created');
		await t
			.withIdentity({ subject: 'learner-user' })
			.mutation(api.sessions.setRsvp, { sessionId: session._id, status: 'going' });
		await t
			.withIdentity({ subject: 'guide-user' })
			.mutation(api.sessions.cancel, { sessionId: session._id });
		await t.finishAllScheduledFunctions(vi.runAllTimers);

		const notifications = await notificationsFor(t, learnerProfileId);
		expect(notifications).toHaveLength(1);
		expect(notifications[0].title).toBe('Session cancelled');
		expect(sendEmailMock).toHaveBeenCalledWith(
			expect.objectContaining({ to: 'learner@example.com', subject: 'Session cancelled' })
		);
	});
});

describe('child account email routing', () => {
	it('routes CRITICAL emails to the approved parent email', async () => {
		vi.useFakeTimers();
		const { t, clubId, childProfileId } = await seedFixture();

		const memberId = await memberIdFor(t, clubId, childProfileId);
		await t
			.withIdentity({ subject: 'guide-user' })
			.mutation(api.clubs.kickMember, { clubMemberId: memberId, reason: 'Testing' });
		await t.finishAllScheduledFunctions(vi.runAllTimers);

		const notifications = await notificationsFor(t, childProfileId);
		expect(notifications).toHaveLength(1);
		expect(sendEmailMock).toHaveBeenCalledTimes(1);
		expect(sendEmailMock).toHaveBeenCalledWith(
			expect.objectContaining({ to: 'parent@example.com', subject: 'Removed from club' })
		);
	});

	it('sends no email at all to child accounts for high kinds (in-app only)', async () => {
		vi.useFakeTimers();
		const { t, clubId, childProfileId } = await seedFixture();

		const session = await t.withIdentity({ subject: 'guide-user' }).mutation(api.sessions.create, {
			clubId,
			location: 'Club HQ',
			startTime: Date.now() + 2 * HOUR,
			endTime: Date.now() + 3 * HOUR
		});
		if (!session) throw new Error('session not created');
		await t
			.withIdentity({ subject: 'child-user' })
			.mutation(api.sessions.setRsvp, { sessionId: session._id, status: 'going' });
		// Default-going (CL-712) would notify the adult learner too; opt them out so this test
		// isolates the child's email routing.
		await t
			.withIdentity({ subject: 'learner-user' })
			.mutation(api.sessions.setRsvp, { sessionId: session._id, status: 'not_going' });
		await t
			.withIdentity({ subject: 'guide-user' })
			.mutation(api.sessions.cancel, { sessionId: session._id });
		await t.finishAllScheduledFunctions(vi.runAllTimers);

		const notifications = await notificationsFor(t, childProfileId);
		expect(notifications).toHaveLength(1);
		expect(notifications[0].title).toBe('Session cancelled');
		expect(sendEmailMock).not.toHaveBeenCalled();
	});
});

describe('new member joined producer', () => {
	it('notifies club guides in-app (no email: medium tier) when someone joins by code', async () => {
		vi.useFakeTimers();
		const { t, guideProfileId, learnerProfileId } = await seedFixture();
		await t.run(async (ctx) => {
			await ctx.db.insert('profiles', {
				authUserId: 'newbie-user',
				firstName: 'Nel',
				lastName: 'Newbie',
				isVerified: true,
				firstLoginCompleted: true,
				updatedAt: Date.now()
			});
		});

		const result = await t
			.withIdentity({ subject: 'newbie-user' })
			.mutation(api.clubs.joinClubWithCode, { code: 'ABC234' });
		expect(result.ok).toBe(true);
		await t.finishAllScheduledFunctions(vi.runAllTimers);

		const guideNotifications = await notificationsFor(t, guideProfileId);
		expect(guideNotifications).toHaveLength(1);
		expect(guideNotifications[0].title).toBe('New member joined');
		expect(guideNotifications[0].message).toContain('Nel Newbie');

		// Existing non-guide members are not notified.
		expect(await notificationsFor(t, learnerProfileId)).toHaveLength(0);
		// Medium tier: in-app only.
		expect(sendEmailMock).not.toHaveBeenCalled();
	});

	it('is muted by the clubMemberChanges preference', async () => {
		vi.useFakeTimers();
		const { t, guideProfileId } = await seedFixture();
		await setAllPreferencesOff(t, guideProfileId, { notificationsEnabled: true });
		await t.run(async (ctx) => {
			await ctx.db.insert('profiles', {
				authUserId: 'newbie-user',
				isVerified: true,
				firstLoginCompleted: true,
				updatedAt: Date.now()
			});
		});

		await t.withIdentity({ subject: 'newbie-user' }).mutation(api.clubs.joinClubWithCode, {
			code: 'ABC234'
		});
		await t.finishAllScheduledFunctions(vi.runAllTimers);

		expect(await notificationsFor(t, guideProfileId)).toHaveLength(0);
	});
});

describe('session reminder scheduling (24h before start)', () => {
	it('reminds all active members 24h before start, respecting the sessionReminder preference', async () => {
		vi.useFakeTimers();
		const { t, clubId, guideProfileId, learnerProfileId, childProfileId } = await seedFixture();
		// Child muted the session reminder.
		await setAllPreferencesOff(t, childProfileId, {
			notificationsEnabled: true,
			notificationPreferences: { sessionActivityChanges: true }
		});

		const startTime = Date.now() + 48 * HOUR;
		const session = await t.withIdentity({ subject: 'guide-user' }).mutation(api.sessions.create, {
			clubId,
			location: 'Club HQ',
			startTime,
			endTime: startTime + HOUR
		});
		if (!session) throw new Error('session not created');

		await vi.advanceTimersByTimeAsync(25 * HOUR);
		await t.finishAllScheduledFunctions(vi.runAllTimers);

		const reminderTitles = async (profileId: Id<'profiles'>) =>
			(await notificationsFor(t, profileId)).filter((n) => n.title === 'Session tomorrow');
		expect(await reminderTitles(guideProfileId)).toHaveLength(1);
		expect(await reminderTitles(learnerProfileId)).toHaveLength(1);
		expect(await reminderTitles(childProfileId)).toHaveLength(0);
	});

	it('does not schedule a reminder for sessions starting within 24h', async () => {
		vi.useFakeTimers();
		const { t, clubId } = await seedFixture();

		const startTime = Date.now() + 2 * HOUR;
		const session = await t.withIdentity({ subject: 'guide-user' }).mutation(api.sessions.create, {
			clubId,
			location: 'Club HQ',
			startTime,
			endTime: startTime + HOUR
		});
		if (!session) throw new Error('session not created');

		const scheduledJobs = await t.run((ctx) =>
			ctx.db.system.query('_scheduled_functions').collect()
		);
		// Only the attendance reminder is scheduled; no 24h session reminder.
		expect(scheduledJobs).toHaveLength(1);
		expect(scheduledJobs[0].scheduledTime).toBe(startTime + HOUR);
	});

	it('cancels and reschedules the reminder when the start time changes, and cancels on session cancel', async () => {
		vi.useFakeTimers();
		const { t, clubId, learnerProfileId } = await seedFixture();

		const startTime = Date.now() + 48 * HOUR;
		const session = await t.withIdentity({ subject: 'guide-user' }).mutation(api.sessions.create, {
			clubId,
			location: 'Club HQ',
			startTime,
			endTime: startTime + HOUR
		});
		if (!session) throw new Error('session not created');

		const newStartTime = startTime + 24 * HOUR;
		await t.withIdentity({ subject: 'guide-user' }).mutation(api.sessions.update, {
			sessionId: session._id,
			location: 'Club HQ',
			startTime: newStartTime,
			endTime: newStartTime + HOUR
		});

		let jobs = await t.run((ctx) => ctx.db.system.query('_scheduled_functions').collect());
		const originalReminder = jobs.find((job) => job.scheduledTime === startTime - 24 * HOUR);
		const rescheduledReminder = jobs.find(
			(job) => job.scheduledTime === newStartTime - 24 * HOUR
		);
		expect(originalReminder?.state.kind).toBe('canceled');
		expect(rescheduledReminder?.state.kind).toBe('pending');

		await t
			.withIdentity({ subject: 'guide-user' })
			.mutation(api.sessions.cancel, { sessionId: session._id });
		jobs = await t.run((ctx) => ctx.db.system.query('_scheduled_functions').collect());
		// Cancellation itself schedules notification/email jobs (default-going members are
		// notified), so restrict the assertion to the session/attendance reminder jobs.
		expect(
			jobs
				.filter((job) => job.state.kind === 'pending')
				.filter((job) => job.name.includes('Reminder'))
				.filter((job) => job.scheduledTime < newStartTime)
		).toHaveLength(0);

		// Drain the queue: the cancelled session must produce no reminder.
		await vi.advanceTimersByTimeAsync(80 * HOUR);
		await t.finishAllScheduledFunctions(vi.runAllTimers);
		const reminders = (await notificationsFor(t, learnerProfileId)).filter(
			(n) => n.title === 'Session tomorrow'
		);
		expect(reminders).toHaveLength(0);
	});
});
