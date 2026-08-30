/// <reference types="vite/client" />

// Chat email notifications (CL-764): the per-user delayed "new messages" email. One email per
// (recipient, room) per unread batch, CHAT_EMAIL_DELAY_MS after the batch's first message;
// reading the room during the grace window suppresses it, and nothing re-sends until the room
// is opened again.

import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

const DAY = 24 * 60 * 60 * 1000;

const { sendEmailMock, authEmailByUserId } = vi.hoisted(() => ({
	sendEmailMock: vi.fn(async () => {}),
	authEmailByUserId: new Map<string, string>([
		['guide-user', 'guide@example.com'],
		['learner-user', 'learner@example.com'],
		['child-user', 'kiddo@children.curiosity.local']
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
	vi.unstubAllEnvs();
});

const seedFixture = async (options: { withChild?: boolean; learnerLeftAt?: number } = {}) => {
	const t = convexTest(schema, modules);
	const ids = await t.run(async (ctx) => {
		const now = Date.now();
		const memberJoinedAt = now - 30 * DAY;
		const guideRoleId = await ctx.db.insert('clubRoles', {
			key: 'guide',
			name: 'Guide',
			permissions: ['club:read'],
			order: 0,
			createdAt: memberJoinedAt
		});
		const learnerRoleId = await ctx.db.insert('clubRoles', {
			key: 'learner',
			name: 'Learner',
			permissions: ['club:read'],
			order: 1,
			createdAt: memberJoinedAt
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
		const clubId = await ctx.db.insert('clubs', {
			name: 'Curiosity Club',
			discoverable: false,
			createdByProfileId: guideProfileId,
			createdAt: memberJoinedAt,
			updatedAt: now
		});
		const roomId = await ctx.db.insert('rooms', { contextType: 'club', clubId });
		await ctx.db.insert('clubMembers', {
			clubId,
			profileId: guideProfileId,
			roleId: guideRoleId,
			createdAt: memberJoinedAt
		});
		await ctx.db.insert('clubMembers', {
			clubId,
			profileId: learnerProfileId,
			roleId: learnerRoleId,
			...(options.learnerLeftAt ? { leftAt: options.learnerLeftAt } : {}),
			createdAt: memberJoinedAt
		});

		let childProfileId: Id<'profiles'> | null = null;
		if (options.withChild) {
			childProfileId = await ctx.db.insert('profiles', {
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
			await ctx.db.insert('clubMembers', {
				clubId,
				profileId: childProfileId,
				roleId: learnerRoleId,
				createdAt: memberJoinedAt
			});
		}

		return { clubId, roomId, guideProfileId, learnerProfileId, childProfileId };
	});

	return {
		t,
		guide: t.withIdentity({ subject: 'guide-user' }),
		learner: t.withIdentity({ subject: 'learner-user' }),
		...ids
	};
};

const muteChatMessagesFor = async (
	t: Awaited<ReturnType<typeof seedFixture>>['t'],
	profileId: Id<'profiles'>
) => {
	await t.run(async (ctx) => {
		await ctx.db.insert('userPreferences', {
			profileId,
			theme: 'system',
			notificationsEnabled: true,
			notificationPreferences: {
				clubMemberChanges: true,
				projectDeadlineReminder: true,
				projectMemberAdded: true,
				projectCompleted: true,
				sessionReminder: true,
				sessionActivityChanges: true,
				updateLikes: true,
				updateComments: true,
				chatMessages: false
			},
			updatedAt: Date.now()
		});
	});
};

const emailMarkerFor = (
	t: Awaited<ReturnType<typeof seedFixture>>['t'],
	profileId: Id<'profiles'>,
	roomId: Id<'rooms'>
) =>
	t.run(
		async (ctx) =>
			await ctx.db
				.query('roomEmailMarkers')
				.withIndex('by_profile_and_room', (q) => q.eq('profileId', profileId).eq('roomId', roomId))
				.first()
	);

describe('chat email notifications', () => {
	it('emails a recipient once the grace window passes with the message still unread', async () => {
		vi.useFakeTimers();
		const { t, guide, roomId } = await seedFixture();

		await guide.mutation(api.chat.sendMessage, { roomId, content: 'Anyone around?' });
		await t.finishAllScheduledFunctions(vi.runAllTimers);

		expect(sendEmailMock).toHaveBeenCalledTimes(1);
		expect(sendEmailMock).toHaveBeenCalledWith(
			expect.objectContaining({
				to: 'learner@example.com',
				type: 'notification',
				subject: 'New messages in Curiosity Club'
			})
		);
	});

	it('links the email to the specific room', async () => {
		vi.useFakeTimers();
		// Relative notification urls only become CTA links when a base url is configured
		// (notifications.sendNotificationEmail drops them otherwise).
		vi.stubEnv('BETTER_AUTH_URL', 'https://app.example.com');
		const { t, guide, roomId } = await seedFixture();

		await guide.mutation(api.chat.sendMessage, { roomId, content: 'Deep link?' });
		await t.finishAllScheduledFunctions(vi.runAllTimers);

		expect(sendEmailMock).toHaveBeenCalledTimes(1);
		const [{ html }] = sendEmailMock.mock.calls[0] as unknown as [{ html: string }];
		expect(html).toContain(`https://app.example.com/chat?room=${roomId}`);
	});

	it('sends nothing when the recipient reads the room during the grace window', async () => {
		vi.useFakeTimers();
		const { t, guide, learner, roomId, learnerProfileId } = await seedFixture();

		await guide.mutation(api.chat.sendMessage, { roomId, content: 'Quick question' });
		await learner.mutation(api.chat.markRoomRead, { roomId });
		await t.finishAllScheduledFunctions(vi.runAllTimers);

		expect(sendEmailMock).not.toHaveBeenCalled();
		// The batch stays un-emailed, so the next message re-schedules from scratch.
		const marker = await emailMarkerFor(t, learnerProfileId, roomId);
		expect(marker?.lastEmailedAt).toBeUndefined();
	});

	it('a burst of messages produces a single email', async () => {
		vi.useFakeTimers();
		const { t, guide, roomId } = await seedFixture();

		await guide.mutation(api.chat.sendMessage, { roomId, content: 'One' });
		await guide.mutation(api.chat.sendMessage, { roomId, content: 'Two' });
		await guide.mutation(api.chat.sendMessage, { roomId, content: 'Three' });
		await t.finishAllScheduledFunctions(vi.runAllTimers);

		expect(sendEmailMock).toHaveBeenCalledTimes(1);
	});

	it('does not email again until the recipient opens the room', async () => {
		vi.useFakeTimers();
		const { t, guide, learner, roomId } = await seedFixture();

		await guide.mutation(api.chat.sendMessage, { roomId, content: 'First batch' });
		await t.finishAllScheduledFunctions(vi.runAllTimers);
		expect(sendEmailMock).toHaveBeenCalledTimes(1);

		// More unseen messages on top of an already-emailed batch: still one email.
		await guide.mutation(api.chat.sendMessage, { roomId, content: 'Still first batch' });
		await t.finishAllScheduledFunctions(vi.runAllTimers);
		expect(sendEmailMock).toHaveBeenCalledTimes(1);

		// Opening the room re-arms the notification for the next batch.
		await learner.mutation(api.chat.markRoomRead, { roomId });
		await guide.mutation(api.chat.sendMessage, { roomId, content: 'Second batch' });
		await t.finishAllScheduledFunctions(vi.runAllTimers);
		expect(sendEmailMock).toHaveBeenCalledTimes(2);
	});

	it('respects the chatMessages mute preference', async () => {
		vi.useFakeTimers();
		const { t, guide, roomId, learnerProfileId } = await seedFixture();
		await muteChatMessagesFor(t, learnerProfileId);

		await guide.mutation(api.chat.sendMessage, { roomId, content: 'Muted?' });
		await t.finishAllScheduledFunctions(vi.runAllTimers);

		expect(sendEmailMock).not.toHaveBeenCalled();
	});

	it('never emails members who left the club', async () => {
		vi.useFakeTimers();
		const { t, guide, roomId } = await seedFixture({ learnerLeftAt: Date.now() - DAY });

		await guide.mutation(api.chat.sendMessage, { roomId, content: 'Without Lars' });
		await t.finishAllScheduledFunctions(vi.runAllTimers);

		expect(sendEmailMock).not.toHaveBeenCalled();
	});

	it('sends no email at all to child accounts (adult members still get theirs)', async () => {
		vi.useFakeTimers();
		const { t, guide, roomId } = await seedFixture({ withChild: true });

		await guide.mutation(api.chat.sendMessage, { roomId, content: 'Hello everyone' });
		await t.finishAllScheduledFunctions(vi.runAllTimers);

		// chat_activity is high tier, and non-critical emails never route to a child account's
		// parent address — the child gets nothing while the adult learner is emailed normally.
		expect(sendEmailMock).toHaveBeenCalledTimes(1);
		expect(sendEmailMock).toHaveBeenCalledWith(
			expect.objectContaining({ to: 'learner@example.com' })
		);
	});

	it('tracks delivery state per (recipient, room) on roomEmailMarkers', async () => {
		vi.useFakeTimers();
		const { t, guide, roomId, learnerProfileId, guideProfileId } = await seedFixture();

		await guide.mutation(api.chat.sendMessage, { roomId, content: 'Marker check' });
		const pending = await emailMarkerFor(t, learnerProfileId, roomId);
		expect(pending?.scheduledFor).toBeGreaterThan(Date.now());
		expect(pending?.lastEmailedAt).toBeUndefined();

		await t.finishAllScheduledFunctions(vi.runAllTimers);
		const delivered = await emailMarkerFor(t, learnerProfileId, roomId);
		expect(delivered?.scheduledFor).toBeUndefined();
		expect(delivered?.lastEmailedAt).toBeDefined();

		// The sender never gets email state for their own messages.
		expect(await emailMarkerFor(t, guideProfileId, roomId)).toBeNull();
	});
});
