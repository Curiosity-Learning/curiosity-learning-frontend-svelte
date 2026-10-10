/// <reference types="vite/client" />

// Chat email notifications (CL-764): the per-user delayed "new messages" email. One email per
// (recipient, room) per unread batch, CHAT_EMAIL_DELAY_MS after the batch's first message;
// reading the room during the grace window suppresses it. Coverage (roomEmailMarkers
// .coveredThroughAt) only advances once the provider accepted the email; reading the emailed
// batch re-arms the next one immediately, an unread emailed batch is not nagged about for 12h.

import betterAuthTest from '@convex-dev/better-auth/test';
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, components, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

const DAY = 24 * 60 * 60 * 1000;

const { sendEmailMock, authEmailByUserId } = vi.hoisted(() => ({
	sendEmailMock: vi.fn(async () => ({ providerMessageId: 'resend-msg-1' })),
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
	sendEmailMock.mockReset();
	sendEmailMock.mockResolvedValue({ providerMessageId: 'resend-msg-1' });
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
});

// Parent emails carry one-time sign-in links minted through the betterAuth component
// (magicLinks.ts), so every test mounts the real component and the parent has an account there —
// consent approval creates one (childSignup.approveConsent).
const createTest = async () => {
	const t = convexTest(schema, modules);
	betterAuthTest.register(t);
	const now = Date.now();
	await t.mutation(components.betterAuth.adapter.create, {
		input: {
			model: 'user',
			data: {
				email: 'parent@example.com',
				emailVerified: true,
				name: 'parent',
				createdAt: now,
				updatedAt: now
			}
		}
	});
	return t;
};

// The magic sign-in links in an email's plain-text body, with the paths the verify endpoint will
// redirect to (it decodes the callback params once more, see lib/auth/magic-link.ts).
const magicLinksIn = (text: string) =>
	(text.match(/https:\/\/app\.example\.com\/api\/auth\/magic-link\/verify\?\S+/g) ?? []).map(
		(raw) => {
			const url = new URL(raw);
			return {
				token: url.searchParams.get('token'),
				callbackURL: decodeURIComponent(url.searchParams.get('callbackURL') ?? ''),
				errorCallbackURL: decodeURIComponent(url.searchParams.get('errorCallbackURL') ?? '')
			};
		}
	);

const expiredLinkPath = (next: string) =>
	`/auth/sign-in?next=${encodeURIComponent(next)}&link=expired`;

const seedFixture = async (options: { withChild?: boolean; learnerLeftAt?: number } = {}) => {
	const t = await createTest();
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

const emailDeliveriesFor = (
	t: Awaited<ReturnType<typeof seedFixture>>['t'],
	profileId: Id<'profiles'>
) =>
	t.run(
		async (ctx) =>
			await ctx.db
				.query('emailDeliveries')
				.withIndex('by_recipient', (q) => q.eq('recipientProfileId', profileId))
				.collect()
	);

const seedJoinRequestFixture = async (options: { childRequester?: boolean } = {}) => {
	const t = await createTest();
	const ids = await t.run(async (ctx) => {
		const now = Date.now();
		const guideRoleId = await ctx.db.insert('clubRoles', {
			key: 'guide',
			name: 'Guide',
			permissions: ['club:read', 'club_join_request:decide'],
			order: 0,
			createdAt: now - 30 * DAY
		});
		const guideProfileId = await ctx.db.insert('profiles', {
			authUserId: 'guide-user',
			firstName: 'Gina',
			lastName: 'Guide',
			isVerified: true,
			firstLoginCompleted: true,
			updatedAt: now
		});
		const requesterProfileId = options.childRequester
			? await ctx.db.insert('profiles', {
					authUserId: 'child-user',
					username: 'kiddo',
					isVerified: true,
					firstLoginCompleted: true,
					updatedAt: now
				})
			: await ctx.db.insert('profiles', {
					authUserId: 'learner-user',
					firstName: 'Lars',
					lastName: 'Learner',
					isVerified: true,
					firstLoginCompleted: true,
					updatedAt: now
				});
		if (options.childRequester) {
			await ctx.db.insert('parentChildConsents', {
				childProfileId: requesterProfileId,
				parentEmail: 'parent@example.com',
				status: 'approved',
				token: 'token-1',
				approvedAt: now,
				createdAt: now,
				updatedAt: now
			});
		}
		const clubId = await ctx.db.insert('clubs', {
			name: 'Porto Club',
			discoverable: true,
			createdByProfileId: guideProfileId,
			createdAt: now - 30 * DAY,
			updatedAt: now
		});
		await ctx.db.insert('clubMembers', {
			clubId,
			profileId: guideProfileId,
			roleId: guideRoleId,
			createdAt: now - 30 * DAY
		});
		const joinRequestId = await ctx.db.insert('joinRequests', {
			clubId,
			requesterProfileId,
			status: 'pending',
			createdAt: now - DAY
		});
		const roomId = await ctx.db.insert('rooms', { contextType: 'joinRequest', joinRequestId });
		return { roomId, guideProfileId, requesterProfileId };
	});
	return {
		t,
		guide: t.withIdentity({ subject: 'guide-user' }),
		requester: t.withIdentity({ subject: options.childRequester ? 'child-user' : 'learner-user' }),
		...ids
	};
};

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

	// One missed email must not mean permanent silence: NEW activity more than 12h after the
	// last email re-arms the notification even for a never-opened room. Message-driven — a room
	// that goes quiet never re-emails on a timer.
	it('new activity after the 12h repeat window re-emails an unopened room', async () => {
		vi.useFakeTimers();
		const { t, guide, roomId } = await seedFixture();

		await guide.mutation(api.chat.sendMessage, { roomId, content: 'First conversation' });
		await t.finishAllScheduledFunctions(vi.runAllTimers);
		expect(sendEmailMock).toHaveBeenCalledTimes(1);

		vi.advanceTimersByTime(12 * 60 * 60 * 1000 + 1);
		await guide.mutation(api.chat.sendMessage, { roomId, content: 'Next-day follow-up' });
		await t.finishAllScheduledFunctions(vi.runAllTimers);
		expect(sendEmailMock).toHaveBeenCalledTimes(2);

		// Silence alone never triggers a third email, no matter how long passes.
		vi.advanceTimersByTime(72 * 60 * 60 * 1000);
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

	// Child accounts have no real address of their own. Club/project chat (high tier) goes to
	// the approved parent — worded for a parent, linking to their read-only view of the child's
	// chats, and telling them they can hand these emails over to the child by setting an email
	// address for them — unless the parent already did, in which case the child is emailed like
	// any other member. Critical (application/join-request) chat always goes to the parent.
	it('club chat for a child account goes to the parent, with a nudge to set the child an email', async () => {
		vi.useFakeTimers();
		vi.stubEnv('BETTER_AUTH_URL', 'https://app.example.com');
		const { t, guide, roomId, childProfileId } = await seedFixture({ withChild: true });

		await guide.mutation(api.chat.sendMessage, { roomId, content: 'Hello everyone' });
		await t.finishAllScheduledFunctions(vi.runAllTimers);

		expect(sendEmailMock).toHaveBeenCalledTimes(2);
		expect(sendEmailMock).toHaveBeenCalledWith(
			expect.objectContaining({
				to: 'learner@example.com',
				subject: 'New messages in Curiosity Club'
			})
		);
		expect(sendEmailMock).toHaveBeenCalledWith(
			expect.objectContaining({
				to: 'parent@example.com',
				subject: 'New messages for kiddo in Curiosity Club'
			})
		);
		const parentCall = (
			sendEmailMock.mock.calls as unknown as Array<[{ to: string; html: string; text: string }]>
		)
			.map(([call]) => call)
			.find((call) => call.to === 'parent@example.com')!;
		// The parent's account has no password (created at consent approval), so both links are
		// one-time sign-in links: the button continues to the child's chats in this room, the
		// note's link to the child's overview. Each token works once, so they differ.
		const childChatPath = `/child/${childProfileId}?room=${roomId}`;
		const [cta, noteLink] = magicLinksIn(parentCall.text);
		expect(cta).toEqual({
			token: expect.stringMatching(/^[a-zA-Z]{32}$/),
			callbackURL: childChatPath,
			errorCallbackURL: expiredLinkPath(childChatPath)
		});
		expect(noteLink).toEqual({
			token: expect.stringMatching(/^[a-zA-Z]{32}$/),
			callbackURL: `/child/${childProfileId}`,
			errorCallbackURL: expiredLinkPath(`/child/${childProfileId}`)
		});
		expect(noteLink.token).not.toBe(cta.token);
		// No plain app links left that would strand the parent on a password form.
		expect(parentCall.html).not.toContain(`https://app.example.com/child/`);
		expect(parentCall.html).toContain('Open kiddo&#39;s chats');
		expect(parentCall.html).toContain('Add an email address for kiddo');
		expect(parentCall.text).toContain(
			'You get these emails because kiddo has a child account. The button signs you in — no password needed. Add an email address for kiddo and chat notifications like this one will go to them directly.'
		);
		expect(parentCall.text).not.toContain('Forgot password');
		// Adults get plain links into their own chat.
		const learnerCall = (
			sendEmailMock.mock.calls as unknown as Array<[{ to: string; text: string }]>
		)
			.map(([call]) => call)
			.find((call) => call.to === 'learner@example.com')!;
		expect(magicLinksIn(learnerCall.text)).toEqual([]);
		// Audit row names the resolved address, not the child's synthetic one.
		const deliveries = await emailDeliveriesFor(t, childProfileId!);
		expect(deliveries).toHaveLength(1);
		expect(deliveries[0].to).toBe('parent@example.com');
	});

	// Consents approved before parent accounts were created at approval time have no account to
	// sign in to; a sign-in link could only fail (disableSignUp), so they keep the plain links.
	it('a parent without an account gets plain links instead of sign-in links', async () => {
		vi.useFakeTimers();
		vi.stubEnv('BETTER_AUTH_URL', 'https://app.example.com');
		const { t, guide, roomId, childProfileId } = await seedFixture({ withChild: true });
		await t.mutation(components.betterAuth.adapter.deleteOne, {
			input: { model: 'user', where: [{ field: 'email', value: 'parent@example.com' }] }
		});

		await guide.mutation(api.chat.sendMessage, { roomId, content: 'Hello everyone' });
		await t.finishAllScheduledFunctions(vi.runAllTimers);

		const parentCall = (
			sendEmailMock.mock.calls as unknown as Array<[{ to: string; text: string }]>
		)
			.map(([call]) => call)
			.find((call) => call.to === 'parent@example.com')!;
		expect(magicLinksIn(parentCall.text)).toEqual([]);
		expect(parentCall.text).toContain(
			`https://app.example.com/child/${childProfileId}?room=${roomId}`
		);
		expect(parentCall.text).not.toContain('signs you in');
	});

	it('club chat for a child account stops going to a parent the child has unlinked', async () => {
		vi.useFakeTimers();
		const { t, guide, roomId, childProfileId } = await seedFixture({ withChild: true });
		await t.run(async (ctx) => {
			const consent = await ctx.db
				.query('parentChildConsents')
				.withIndex('by_child_profile_id', (q) => q.eq('childProfileId', childProfileId!))
				.unique();
			await ctx.db.patch(consent!._id, { unlinkedAt: Date.now() });
		});

		await guide.mutation(api.chat.sendMessage, { roomId, content: 'Hello everyone' });
		await t.finishAllScheduledFunctions(vi.runAllTimers);

		expect(sendEmailMock).toHaveBeenCalledTimes(1);
		expect(sendEmailMock).not.toHaveBeenCalledWith(
			expect.objectContaining({ to: 'parent@example.com' })
		);
	});

	it('club chat goes straight to the child once the parent has set their notification email', async () => {
		vi.useFakeTimers();
		vi.stubEnv('BETTER_AUTH_URL', 'https://app.example.com');
		const { t, guide, roomId, childProfileId } = await seedFixture({ withChild: true });
		await t.run(async (ctx) => {
			await ctx.db.patch(childProfileId!, { notificationEmail: 'kiddo@example.com' });
		});

		await guide.mutation(api.chat.sendMessage, { roomId, content: 'Hello everyone' });
		await t.finishAllScheduledFunctions(vi.runAllTimers);

		expect(sendEmailMock).toHaveBeenCalledTimes(2);
		expect(sendEmailMock).not.toHaveBeenCalledWith(
			expect.objectContaining({ to: 'parent@example.com' })
		);
		// Worded for the child themselves, linking to their own chat, and no parent nudge.
		expect(sendEmailMock).toHaveBeenCalledWith(
			expect.objectContaining({
				to: 'kiddo@example.com',
				subject: 'New messages in Curiosity Club'
			})
		);
		const childCall = (sendEmailMock.mock.calls as unknown as Array<[{ to: string; html: string }]>)
			.map(([call]) => call)
			.find((call) => call.to === 'kiddo@example.com');
		expect(childCall?.html).toContain(`https://app.example.com/chat?room=${roomId}`);
		expect(childCall?.html).not.toContain('Add an email address');
		// The child gets a plain link: sign-in links are only for the parent's own address.
		expect(childCall?.html).not.toContain('magic-link');
		expect(childCall?.html).toContain('Open Curiosity Learning');
	});

	it("the child's notification email still respects their chatMessages mute preference", async () => {
		vi.useFakeTimers();
		const { t, guide, roomId, childProfileId } = await seedFixture({ withChild: true });
		await t.run(async (ctx) => {
			await ctx.db.patch(childProfileId!, { notificationEmail: 'kiddo@example.com' });
		});
		await muteChatMessagesFor(t, childProfileId!);

		await guide.mutation(api.chat.sendMessage, { roomId, content: 'Hello everyone' });
		await t.finishAllScheduledFunctions(vi.runAllTimers);

		expect(sendEmailMock).toHaveBeenCalledTimes(1);
		expect(sendEmailMock).toHaveBeenCalledWith(
			expect.objectContaining({ to: 'learner@example.com' })
		);
	});

	// Subject wording for 1:1-style rooms (CL-764 follow-up): the recipient is not in the app, so
	// the subject alone must identify the conversation — "from {person}" for the reviewer/staff
	// side, "your {name} application" for the applicant (whose application name equals the club
	// name, making the bare name ambiguous with the club's group chat).
	it('application room: applicant and staff get context-specific subjects', async () => {
		vi.useFakeTimers();
		const t = await createTest();
		const { roomId } = await t.run(async (ctx) => {
			const now = Date.now();
			const applicantProfileId = await ctx.db.insert('profiles', {
				authUserId: 'learner-user',
				firstName: 'Lars',
				lastName: 'Learner',
				isVerified: true,
				firstLoginCompleted: true,
				updatedAt: now
			});
			await ctx.db.insert('profiles', {
				authUserId: 'guide-user',
				firstName: 'Gina',
				lastName: 'Guide',
				globalRole: 'admin',
				isVerified: true,
				firstLoginCompleted: true,
				updatedAt: now
			});
			const applicationId = await ctx.db.insert('clubApplications', {
				applicantProfileId,
				status: 'pending',
				name: 'Lisbon Curiosity Club',
				createdAt: now - DAY,
				updatedAt: now - DAY
			});
			const roomId = await ctx.db.insert('rooms', {
				contextType: 'clubApplication',
				clubApplicationId: applicationId
			});
			return { roomId };
		});
		const staff = t.withIdentity({ subject: 'guide-user' });
		const applicant = t.withIdentity({ subject: 'learner-user' });

		// Staff writes → the applicant's email says it's about THEIR application, not the club chat.
		await staff.mutation(api.chat.sendMessage, { roomId, content: 'Hi from the review team' });
		await t.finishAllScheduledFunctions(vi.runAllTimers);
		expect(sendEmailMock).toHaveBeenCalledWith(
			expect.objectContaining({
				to: 'learner@example.com',
				// No club name on purpose: "your club application" fully identifies the room for
				// its addressee, and the auto-generated application name is location noise.
				subject: 'New messages regarding your club application'
			})
		);

		// Applicant replies → the staff email leads with who it is from.
		sendEmailMock.mockClear();
		await applicant.mutation(api.chat.markRoomRead, { roomId });
		await applicant.mutation(api.chat.sendMessage, { roomId, content: 'Thanks, question...' });
		await t.finishAllScheduledFunctions(vi.runAllTimers);
		expect(sendEmailMock).toHaveBeenCalledWith(
			expect.objectContaining({
				to: 'guide@example.com',
				subject: 'New messages from Lars Learner (Lisbon Curiosity Club application)'
			})
		);
	});

	// CEO call (CL-764): application/join-request chats are critical — a review conversation
	// stalls if the applicant never hears about a reply, so these emails ignore the chatMessages
	// mute and route to the approved parent for child accounts. Club/project chats stay muteable
	// (covered above) and never email children.
	it('application room: emails ignore the chatMessages mute preference', async () => {
		vi.useFakeTimers();
		const t = await createTest();
		const { roomId, applicantProfileId } = await t.run(async (ctx) => {
			const now = Date.now();
			const applicantProfileId = await ctx.db.insert('profiles', {
				authUserId: 'learner-user',
				firstName: 'Lars',
				lastName: 'Learner',
				isVerified: true,
				firstLoginCompleted: true,
				updatedAt: now
			});
			await ctx.db.insert('profiles', {
				authUserId: 'guide-user',
				firstName: 'Gina',
				lastName: 'Guide',
				globalRole: 'admin',
				isVerified: true,
				firstLoginCompleted: true,
				updatedAt: now
			});
			const applicationId = await ctx.db.insert('clubApplications', {
				applicantProfileId,
				status: 'pending',
				name: 'Lisbon Curiosity Club',
				createdAt: now - DAY,
				updatedAt: now - DAY
			});
			const roomId = await ctx.db.insert('rooms', {
				contextType: 'clubApplication',
				clubApplicationId: applicationId
			});
			return { roomId, applicantProfileId };
		});
		await muteChatMessagesFor(t, applicantProfileId);

		await t
			.withIdentity({ subject: 'guide-user' })
			.mutation(api.chat.sendMessage, { roomId, content: 'Important review question' });
		await t.finishAllScheduledFunctions(vi.runAllTimers);

		expect(sendEmailMock).toHaveBeenCalledWith(
			expect.objectContaining({
				to: 'learner@example.com',
				subject: 'New messages regarding your club application'
			})
		);
	});

	it('application room: a child applicant email routes to the approved parent', async () => {
		vi.useFakeTimers();
		vi.stubEnv('BETTER_AUTH_URL', 'https://app.example.com');
		const t = await createTest();
		const { roomId, childProfileId } = await t.run(async (ctx) => {
			const now = Date.now();
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
			await ctx.db.insert('profiles', {
				authUserId: 'guide-user',
				firstName: 'Gina',
				lastName: 'Guide',
				globalRole: 'admin',
				isVerified: true,
				firstLoginCompleted: true,
				updatedAt: now
			});
			const applicationId = await ctx.db.insert('clubApplications', {
				applicantProfileId: childProfileId,
				status: 'pending',
				name: 'Kids Club',
				createdAt: now - DAY,
				updatedAt: now - DAY
			});
			const roomId = await ctx.db.insert('rooms', {
				contextType: 'clubApplication',
				clubApplicationId: applicationId
			});
			return { roomId, childProfileId };
		});

		// Critical chat goes to the parent even when the child has their own notification email —
		// so the "goes to them directly" nudge, which would be untrue here, is left out too.
		await t.run(async (ctx) => {
			await ctx.db.patch(childProfileId, { notificationEmail: 'kiddo@example.com' });
		});
		await t
			.withIdentity({ subject: 'guide-user' })
			.mutation(api.chat.sendMessage, { roomId, content: 'Question for the applicant' });
		await t.finishAllScheduledFunctions(vi.runAllTimers);

		// The parent reads this as a third party: child-named copy, and the link goes to the
		// parent's read-only view of the child's chats (chat?room= would resolve to nothing).
		expect(sendEmailMock).toHaveBeenCalledTimes(1);
		expect(sendEmailMock).toHaveBeenCalledWith(
			expect.objectContaining({
				to: 'parent@example.com',
				subject: "New messages regarding kiddo's club application"
			})
		);
		const [{ html, text }] = sendEmailMock.mock.calls[0] as unknown as [
			{ html: string; text: string }
		];
		// Signed in by the link itself (one link: there is no note on critical chats).
		const links = magicLinksIn(text);
		expect(links).toHaveLength(1);
		expect(links[0].callbackURL).toBe(`/child/${childProfileId}?room=${roomId}`);
		expect(html).toContain('Open kiddo&#39;s chats');
		expect(html).not.toContain('Add an email address');
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
		expect(delivered?.sendingSince).toBeUndefined();
		expect(delivered?.lastEmailedAt).toBeDefined();
		// Coverage = the newest message the email was about, not the send time.
		const newest = await t.run(
			async (ctx) =>
				await ctx.db
					.query('messages')
					.withIndex('by_room', (q) => q.eq('roomId', roomId))
					.order('desc')
					.first()
		);
		expect(delivered?.coveredThroughAt).toBe(newest?._creationTime);

		// The sender never gets email state for their own messages.
		expect(await emailMarkerFor(t, guideProfileId, roomId)).toBeNull();
	});
	// The Oct 2026 incident: the recipient had read AND replied to the emailed batch, yet a new
	// message 9.5h later was dropped because "already emailed" was judged by send time instead of
	// by which messages the email covered. Reading the emailed batch must re-arm immediately.
	it('re-emails a new batch right away once the recipient has read the emailed one', async () => {
		vi.useFakeTimers();
		const { t, guide, learner, roomId } = await seedFixture();

		await guide.mutation(api.chat.sendMessage, { roomId, content: 'Evening question' });
		await t.finishAllScheduledFunctions(vi.runAllTimers);
		expect(sendEmailMock).toHaveBeenCalledTimes(1);

		// Reads it two hours later (no newer messages, so lastReadAt lands BEFORE the send time).
		vi.advanceTimersByTime(2 * 60 * 60 * 1000);
		await learner.mutation(api.chat.markRoomRead, { roomId });
		await learner.mutation(api.chat.sendMessage, { roomId, content: 'Here is my answer' });

		// A reply well inside the 12h window is a fresh batch and must email the learner again
		// (the learner's own reply separately emails the guide, who never read anything).
		vi.advanceTimersByTime(60 * 60 * 1000);
		await guide.mutation(api.chat.sendMessage, { roomId, content: 'Thanks, one more thing' });
		await t.finishAllScheduledFunctions(vi.runAllTimers);
		const learnerEmails = (sendEmailMock.mock.calls as unknown as Array<[{ to: string }]>).filter(
			([call]) => call.to === 'learner@example.com'
		);
		expect(learnerEmails).toHaveLength(2);
	});

	it('a failed send leaves the batch owed and the next message retries it', async () => {
		vi.useFakeTimers();
		const { t, guide, roomId, learnerProfileId } = await seedFixture();
		sendEmailMock.mockRejectedValueOnce(new Error('Resend send failed: 429 Too Many Requests'));

		await guide.mutation(api.chat.sendMessage, { roomId, content: 'Did this arrive?' });
		await t.finishAllScheduledFunctions(vi.runAllTimers);
		expect(sendEmailMock).toHaveBeenCalledTimes(1);

		// Nothing was delivered, so nothing is covered and no 12h cap applies.
		const afterFailure = await emailMarkerFor(t, learnerProfileId, roomId);
		expect(afterFailure?.coveredThroughAt).toBeUndefined();
		expect(afterFailure?.lastEmailedAt).toBeUndefined();
		expect(afterFailure?.sendingSince).toBeUndefined();
		const deliveries = await emailDeliveriesFor(t, learnerProfileId);
		expect(deliveries).toHaveLength(1);
		expect(deliveries[0]).toMatchObject({
			status: 'failed',
			to: 'learner@example.com',
			kind: 'chat_activity',
			roomId,
			error: 'Resend send failed: 429 Too Many Requests'
		});

		vi.advanceTimersByTime(60 * 1000);
		await guide.mutation(api.chat.sendMessage, { roomId, content: 'Trying again' });
		await t.finishAllScheduledFunctions(vi.runAllTimers);
		expect(sendEmailMock).toHaveBeenCalledTimes(2);
		const afterRetry = await emailMarkerFor(t, learnerProfileId, roomId);
		expect(afterRetry?.coveredThroughAt).toBeDefined();
	});

	it('records every sent chat email on emailDeliveries with the batch it covered', async () => {
		vi.useFakeTimers();
		const { t, guide, roomId, learnerProfileId } = await seedFixture();

		await guide.mutation(api.chat.sendMessage, { roomId, content: 'Logged?' });
		await t.finishAllScheduledFunctions(vi.runAllTimers);

		const deliveries = await emailDeliveriesFor(t, learnerProfileId);
		expect(deliveries).toHaveLength(1);
		expect(deliveries[0]).toMatchObject({
			status: 'sent',
			to: 'learner@example.com',
			kind: 'chat_activity',
			subject: 'New messages in Curiosity Club',
			providerMessageId: 'resend-msg-1',
			roomId
		});
		const marker = await emailMarkerFor(t, learnerProfileId, roomId);
		expect(deliveries[0].coveredThroughAt).toBe(marker?.coveredThroughAt);
	});

	it('does not double-send while a delivery is in flight', async () => {
		vi.useFakeTimers();
		const { t, guide, roomId, learnerProfileId } = await seedFixture();

		await guide.mutation(api.chat.sendMessage, { roomId, content: 'Racing' });
		// Simulate a stale-reschedule race: a second check fires while the first one's email is
		// still with the provider.
		await t.run(async (ctx) => {
			const marker = await ctx.db
				.query('roomEmailMarkers')
				.withIndex('by_profile_and_room', (q) =>
					q.eq('profileId', learnerProfileId).eq('roomId', roomId)
				)
				.first();
			if (marker) await ctx.db.patch(marker._id, { sendingSince: Date.now() - 30 * 1000 });
		});
		await t.mutation(internal.chat.deliverChatEmailNotification, {
			roomId,
			profileId: learnerProfileId
		});
		expect(sendEmailMock).not.toHaveBeenCalled();
	});

	// Markers written before coveredThroughAt existed only carry lastEmailedAt; they must keep
	// behaving (no spam burst on deploy) and heal into the new shape on the next send.
	it('upgrades a legacy marker (lastEmailedAt only) on its next successful email', async () => {
		vi.useFakeTimers();
		const { t, guide, roomId, learnerProfileId } = await seedFixture();
		await guide.mutation(api.chat.sendMessage, { roomId, content: 'Old batch' });
		await t.run(async (ctx) => {
			const marker = await ctx.db
				.query('roomEmailMarkers')
				.withIndex('by_profile_and_room', (q) =>
					q.eq('profileId', learnerProfileId).eq('roomId', roomId)
				)
				.first();
			// As written by the pre-coverage code: send time only, later than the message.
			if (marker) await ctx.db.patch(marker._id, { lastEmailedAt: Date.now() + 60 * 1000 });
		});
		await t.finishAllScheduledFunctions(vi.runAllTimers);
		// Legacy semantics: the send time is the watermark, so the old batch counts as emailed.
		expect(sendEmailMock).not.toHaveBeenCalled();

		vi.advanceTimersByTime(12 * 60 * 60 * 1000 + 1);
		await guide.mutation(api.chat.sendMessage, { roomId, content: 'New batch' });
		await t.finishAllScheduledFunctions(vi.runAllTimers);
		expect(sendEmailMock).toHaveBeenCalledTimes(1);
		const marker = await emailMarkerFor(t, learnerProfileId, roomId);
		expect(marker?.coveredThroughAt).toBeDefined();
	});

	it('join-request room: requester and Guide get role-specific subjects', async () => {
		vi.useFakeTimers();
		const { t, guide, requester, roomId } = await seedJoinRequestFixture();

		await guide.mutation(api.chat.sendMessage, { roomId, content: 'Tell us about yourself' });
		await t.finishAllScheduledFunctions(vi.runAllTimers);
		expect(sendEmailMock).toHaveBeenCalledWith(
			expect.objectContaining({
				to: 'learner@example.com',
				subject: 'New messages in your Porto Club join request'
			})
		);

		sendEmailMock.mockClear();
		await requester.mutation(api.chat.markRoomRead, { roomId });
		await requester.mutation(api.chat.sendMessage, { roomId, content: 'Sure!' });
		await t.finishAllScheduledFunctions(vi.runAllTimers);
		expect(sendEmailMock).toHaveBeenCalledWith(
			expect.objectContaining({
				to: 'guide@example.com',
				subject: 'New messages from Lars Learner (Porto Club join request)'
			})
		);
	});

	it('join-request room: a child requester email goes to the parent with parent copy', async () => {
		vi.useFakeTimers();
		vi.stubEnv('BETTER_AUTH_URL', 'https://app.example.com');
		const { t, guide, roomId, requesterProfileId } = await seedJoinRequestFixture({
			childRequester: true
		});

		await guide.mutation(api.chat.sendMessage, { roomId, content: 'Hi there' });
		await t.finishAllScheduledFunctions(vi.runAllTimers);
		expect(sendEmailMock).toHaveBeenCalledTimes(1);
		expect(sendEmailMock).toHaveBeenCalledWith(
			expect.objectContaining({
				to: 'parent@example.com',
				subject: "New messages regarding kiddo's Porto Club join request"
			})
		);
		const [{ text }] = sendEmailMock.mock.calls[0] as unknown as [{ text: string }];
		const links = magicLinksIn(text);
		expect(links).toHaveLength(1);
		expect(links[0].callbackURL).toBe(`/child/${requesterProfileId}?room=${roomId}`);
	});

	// Application decisions post messages into the room but are announced through their own
	// 'application_status' notification; the room posts must not add a second chat email.
	it('decision messages do not trigger a chat email on top of the status notification', async () => {
		vi.useFakeTimers();
		const t = await createTest();
		const { applicationId, applicantProfileId } = await t.run(async (ctx) => {
			const now = Date.now();
			const applicantProfileId = await ctx.db.insert('profiles', {
				authUserId: 'learner-user',
				firstName: 'Lars',
				lastName: 'Learner',
				isVerified: true,
				firstLoginCompleted: true,
				updatedAt: now
			});
			await ctx.db.insert('profiles', {
				authUserId: 'guide-user',
				firstName: 'Gina',
				lastName: 'Guide',
				globalRole: 'admin',
				isVerified: true,
				firstLoginCompleted: true,
				updatedAt: now
			});
			const applicationId = await ctx.db.insert('clubApplications', {
				applicantProfileId,
				status: 'pending',
				name: 'Lisbon Curiosity Club',
				createdAt: now - DAY,
				updatedAt: now - DAY
			});
			return { applicationId, applicantProfileId };
		});

		await t.withIdentity({ subject: 'guide-user' }).mutation(api.admin.adminDecideApplication, {
			applicationId,
			decision: 'rejected',
			rejectionNote: 'Not this season, sorry.'
		});
		await t.finishAllScheduledFunctions(vi.runAllTimers);

		// Exactly one email: the status notification. No chat marker was ever scheduled.
		expect(sendEmailMock).toHaveBeenCalledTimes(1);
		expect(sendEmailMock).toHaveBeenCalledWith(
			expect.objectContaining({ to: 'learner@example.com', subject: 'Application update' })
		);
		const markers = await t.run(
			async (ctx) =>
				await ctx.db
					.query('roomEmailMarkers')
					.withIndex('by_profile_and_room', (q) => q.eq('profileId', applicantProfileId))
					.collect()
		);
		expect(markers).toHaveLength(0);
		// ...but the room does hold the note and the system notice.
		const messages = await t.run(async (ctx) => await ctx.db.query('messages').collect());
		expect(messages.map((m) => m.content)).toEqual([
			'Not this season, sorry.',
			'This application was not accepted.'
		]);
	});
});
