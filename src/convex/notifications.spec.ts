import betterAuthTest from '@convex-dev/better-auth/test';
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, components } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';
import { parseMagicLinkInterstitialFragment } from '../lib/auth/magic-link';

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
	vi.unstubAllEnvs();
});

// The magic sign-in links in an email's plain-text body (same helper as chatEmail.spec.ts).
// Sign-in links are /auth/link interstitials with the token and `next` in the fragment.
const magicLinksIn = (text: string) =>
	(text.match(/https:\/\/app\.example\.com\/auth\/link#\S+/g) ?? []).map((raw) => {
		const parsed = parseMagicLinkInterstitialFragment(new URL(raw).hash);
		return { token: parsed?.token, next: parsed?.next };
	});

const seedFixture = async () => {
	const t = convexTest(schema, modules);
	// Parent emails carry one-time sign-in links minted through the betterAuth component
	// (magicLinks.ts), so the real component is mounted and the parent has an account there, as
	// consent approval would have created.
	betterAuthTest.register(t);
	await t.mutation(components.betterAuth.adapter.create, {
		input: {
			model: 'user',
			data: {
				email: 'parent@example.com',
				emailVerified: true,
				name: 'parent',
				createdAt: Date.now(),
				updatedAt: Date.now()
			}
		}
	});
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

type SentEmail = { to: string; subject: string; text: string; html: string };
const emailCalls = () =>
	(sendEmailMock.mock.calls as unknown as Array<[SentEmail]>).map(([call]) => call);

const deliveriesFor = (
	t: Awaited<ReturnType<typeof seedFixture>>['t'],
	profileId: Id<'profiles'>
) =>
	t.run((ctx) =>
		ctx.db
			.query('emailDeliveries')
			.withIndex('by_recipient', (q) => q.eq('recipientProfileId', profileId))
			.collect()
	);

describe('child account email routing', () => {
	it('routes CRITICAL emails to the approved parent, worded for them, with a sign-in link to the child view', async () => {
		vi.useFakeTimers();
		vi.stubEnv('BETTER_AUTH_URL', 'https://app.example.com');
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
		// The parent cannot open the child-facing link and has no password: the email says whose
		// account it is about, and the button is a one-time sign-in link into /child/[id].
		const [{ text, html }] = sendEmailMock.mock.calls[0] as unknown as [
			{ text: string; html: string }
		];
		expect(text).toContain("This is about kiddo's Curiosity Learning account.");
		expect(html).toContain('Open kiddo&#39;s account');
		const links = magicLinksIn(text);
		expect(links).toHaveLength(1);
		expect(links[0].next).toBe(`/child/${childProfileId}`);
		expect(text).toContain("This button signs you in — please don't forward this email.");
		expect(text).not.toContain('/notifications');
	});

	it('adult emails keep their own link and wording (no sign-in link)', async () => {
		vi.useFakeTimers();
		vi.stubEnv('BETTER_AUTH_URL', 'https://app.example.com');
		const { t, clubId, learnerProfileId } = await seedFixture();

		const memberId = await memberIdFor(t, clubId, learnerProfileId);
		await t
			.withIdentity({ subject: 'guide-user' })
			.mutation(api.clubs.kickMember, { clubMemberId: memberId, reason: 'Testing' });
		await t.finishAllScheduledFunctions(vi.runAllTimers);

		expect(sendEmailMock).toHaveBeenCalledTimes(1);
		const [{ text, to }] = sendEmailMock.mock.calls[0] as unknown as [{ text: string; to: string }];
		expect(to).toBe('learner@example.com');
		expect(magicLinksIn(text)).toHaveLength(0);
		expect(text).not.toContain('This is about');
		expect(text).not.toContain('signs you in');
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

	// CL-768 (review B3): an address the child has not confirmed yet routes as if unset.
	it("sends high kinds nowhere while the child's notification email is still pending", async () => {
		vi.useFakeTimers();
		const { t, clubId, childProfileId } = await seedFixture();
		await t.run(async (ctx) => {
			await ctx.db.patch(childProfileId, { notificationEmail: 'kiddo@example.com' });
		});

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
		await t
			.withIdentity({ subject: 'learner-user' })
			.mutation(api.sessions.setRsvp, { sessionId: session._id, status: 'not_going' });
		await t
			.withIdentity({ subject: 'guide-user' })
			.mutation(api.sessions.cancel, { sessionId: session._id });
		await t.finishAllScheduledFunctions(vi.runAllTimers);

		expect(await notificationsFor(t, childProfileId)).toHaveLength(1);
		expect(sendEmailMock).not.toHaveBeenCalled();
	});

	it("emails high kinds to the child's notification email once the child has confirmed it", async () => {
		vi.useFakeTimers();
		const { t, clubId, childProfileId } = await seedFixture();
		await t.run(async (ctx) => {
			await ctx.db.patch(childProfileId, {
				notificationEmail: 'kiddo@example.com',
				notificationEmailVerifiedAt: Date.now()
			});
		});

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
		await t
			.withIdentity({ subject: 'learner-user' })
			.mutation(api.sessions.setRsvp, { sessionId: session._id, status: 'not_going' });
		await t
			.withIdentity({ subject: 'guide-user' })
			.mutation(api.sessions.cancel, { sessionId: session._id });
		await t.finishAllScheduledFunctions(vi.runAllTimers);

		expect(sendEmailMock).toHaveBeenCalledTimes(1);
		expect(sendEmailMock).toHaveBeenCalledWith(
			expect.objectContaining({ to: 'kiddo@example.com', subject: 'Session cancelled' })
		);
	});

	// CL-768/CL-769 (review D3/D7): once the child has confirmed an address, a critical notice
	// goes to BOTH, as two separate emails — never one email with two recipients, because the
	// parent copy carries a one-time sign-in link.
	it('critical kinds go to the parent AND the confirmed child address, as two separate emails', async () => {
		vi.useFakeTimers();
		vi.stubEnv('BETTER_AUTH_URL', 'https://app.example.com');
		const { t, clubId, childProfileId } = await seedFixture();
		await t.run(async (ctx) => {
			await ctx.db.patch(childProfileId, {
				notificationEmail: 'kiddo@example.com',
				notificationEmailVerifiedAt: Date.now()
			});
		});

		const memberId = await memberIdFor(t, clubId, childProfileId);
		await t
			.withIdentity({ subject: 'guide-user' })
			.mutation(api.clubs.kickMember, { clubMemberId: memberId, reason: 'Testing' });
		await t.finishAllScheduledFunctions(vi.runAllTimers);

		const calls = emailCalls();
		expect(calls).toHaveLength(2);
		for (const call of calls) expect(typeof call.to).toBe('string');
		const parentCall = calls.find((call) => call.to === 'parent@example.com')!;
		const childCall = calls.find((call) => call.to === 'kiddo@example.com')!;
		expect(parentCall.subject).toBe('Removed from club');
		expect(childCall.subject).toBe('Removed from club');
		// Parent copy: parent wording and the sign-in link; child copy: plain, child wording.
		expect(magicLinksIn(parentCall.text)).toHaveLength(1);
		expect(parentCall.text).toContain("This is about kiddo's Curiosity Learning account.");
		expect(magicLinksIn(childCall.text)).toHaveLength(0);
		expect(childCall.text).not.toContain('This is about');
		expect(childCall.text).not.toContain('signs you in');
		// One audit row per email, each naming its audience.
		const deliveries = await deliveriesFor(t, childProfileId);
		expect(deliveries.map((row) => [row.to, row.audience]).sort()).toEqual([
			['kiddo@example.com', 'self'],
			['parent@example.com', 'parent']
		]);
	});

	it('critical kinds ignore the child mute and the parent settings', async () => {
		vi.useFakeTimers();
		const { t, clubId, childProfileId } = await seedFixture();
		await setAllPreferencesOff(t, childProfileId);
		const memberId = await memberIdFor(t, clubId, childProfileId);
		await t
			.withIdentity({ subject: 'guide-user' })
			.mutation(api.clubs.kickMember, { clubMemberId: memberId, reason: 'Testing' });
		await t.finishAllScheduledFunctions(vi.runAllTimers);

		expect(emailCalls().map((call) => call.to)).toEqual(['parent@example.com']);
		expect(await notificationsFor(t, childProfileId)).toHaveLength(1);
	});
});

// The matrix for the non-critical, non-chat high kinds (notificationRouting.ts), driven through
// a real producer: a cancelled session the child RSVP'd to (session_cancelled, preference key
// sessionActivityChanges).
describe('child account routing for other high kinds (CL-768/CL-769)', () => {
	const cancelSessionForChild = async (
		t: Awaited<ReturnType<typeof seedFixture>>['t'],
		clubId: Id<'clubs'>
	) => {
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
		await t
			.withIdentity({ subject: 'learner-user' })
			.mutation(api.sessions.setRsvp, { sessionId: session._id, status: 'not_going' });
		await t
			.withIdentity({ subject: 'guide-user' })
			.mutation(api.sessions.cancel, { sessionId: session._id });
		await t.finishAllScheduledFunctions(vi.runAllTimers);
	};

	const seed = async (options: {
		confirmed: boolean;
		activityCopies?: boolean;
		childMuted?: boolean;
		unlinked?: boolean;
	}) => {
		const fixture = await seedFixture();
		const { t, childProfileId } = fixture;
		await t.run(async (ctx) => {
			const parentProfileId = await ctx.db.insert('profiles', {
				authUserId: 'parent-user',
				isVerified: true,
				firstLoginCompleted: true,
				updatedAt: Date.now()
			});
			const consent = await ctx.db
				.query('parentChildConsents')
				.withIndex('by_child_profile_id', (q) => q.eq('childProfileId', childProfileId))
				.unique();
			await ctx.db.patch(consent!._id, {
				parentProfileId,
				...(options.unlinked ? { unlinkedAt: Date.now() } : {})
			});
			if (options.confirmed) {
				await ctx.db.patch(childProfileId, {
					notificationEmail: 'kiddo@example.com',
					notificationEmailVerifiedAt: Date.now()
				});
			}
			if (options.activityCopies !== undefined) {
				await ctx.db.insert('parentNotificationSettings', {
					parentProfileId,
					childProfileId,
					chatCopies: false,
					activityCopies: options.activityCopies,
					updatedAt: Date.now()
				});
			}
		});
		if (options.childMuted) {
			await setAllPreferencesOff(t, childProfileId, { notificationsEnabled: true });
		}
		return fixture;
	};

	it('no confirmed child email: nobody is emailed, even with the parent opted into copies', async () => {
		vi.useFakeTimers();
		const { t, clubId, childProfileId } = await seed({ confirmed: false, activityCopies: true });
		await cancelSessionForChild(t, clubId);
		expect(sendEmailMock).not.toHaveBeenCalled();
		expect(await notificationsFor(t, childProfileId)).toHaveLength(1);
	});

	it('confirmed child email, copies off (the default): the child only', async () => {
		vi.useFakeTimers();
		const { t, clubId } = await seed({ confirmed: true, activityCopies: false });
		await cancelSessionForChild(t, clubId);
		expect(emailCalls().map((call) => call.to)).toEqual(['kiddo@example.com']);
	});

	it('confirmed child email, copies on: the child and a separate parent copy saying why', async () => {
		vi.useFakeTimers();
		vi.stubEnv('BETTER_AUTH_URL', 'https://app.example.com');
		const { t, clubId, childProfileId } = await seed({ confirmed: true, activityCopies: true });
		await cancelSessionForChild(t, clubId);

		const calls = emailCalls();
		expect(calls.map((call) => call.to).sort()).toEqual([
			'kiddo@example.com',
			'parent@example.com'
		]);
		const parentCall = calls.find((call) => call.to === 'parent@example.com')!;
		expect(parentCall.subject).toBe('Session cancelled');
		expect(parentCall.text).toContain("This is about kiddo's Curiosity Learning account.");
		expect(parentCall.text).toContain(
			"You're getting a copy because you chose to receive kiddo's activity emails too."
		);
		expect(magicLinksIn(parentCall.text).map((link) => link.next)).toEqual([
			`/child/${childProfileId}`
		]);
		const childCall = calls.find((call) => call.to === 'kiddo@example.com')!;
		expect(childCall.text).not.toContain('getting a copy');
		expect(magicLinksIn(childCall.text)).toHaveLength(0);
		const deliveries = await deliveriesFor(t, childProfileId);
		expect(deliveries.map((row) => row.audience).sort()).toEqual(['parent', 'self']);
	});

	it("the child's mute removes only the child's own copy and the in-app row", async () => {
		vi.useFakeTimers();
		const { t, clubId, childProfileId } = await seed({
			confirmed: true,
			activityCopies: true,
			childMuted: true
		});
		await cancelSessionForChild(t, clubId);
		// Review S6: a child cannot silence what goes to the parent.
		expect(emailCalls().map((call) => call.to)).toEqual(['parent@example.com']);
		expect(await notificationsFor(t, childProfileId)).toHaveLength(0);
	});

	it('child muted and copies off: no email at all', async () => {
		vi.useFakeTimers();
		const { t, clubId } = await seed({ confirmed: true, activityCopies: false, childMuted: true });
		await cancelSessionForChild(t, clubId);
		expect(sendEmailMock).not.toHaveBeenCalled();
	});

	it('a parent the child has unlinked gets no copies, whatever the settings say', async () => {
		vi.useFakeTimers();
		const { t, clubId } = await seed({ confirmed: true, activityCopies: true, unlinked: true });
		await cancelSessionForChild(t, clubId);
		expect(emailCalls().map((call) => call.to)).toEqual(['kiddo@example.com']);
	});

	// Unlink semantics are step 7 (review S7/D4): until then a critical notice still reaches the
	// parent the child unlinked, and the confirmed child address gets its own copy.
	it('critical notices still reach an unlinked parent (unchanged until step 7), plus the child', async () => {
		vi.useFakeTimers();
		const { t, clubId, childProfileId } = await seed({ confirmed: true, unlinked: true });
		const memberId = await memberIdFor(t, clubId, childProfileId);
		await t
			.withIdentity({ subject: 'guide-user' })
			.mutation(api.clubs.kickMember, { clubMemberId: memberId, reason: 'Testing' });
		await t.finishAllScheduledFunctions(vi.runAllTimers);
		expect(
			emailCalls()
				.map((call) => call.to)
				.sort()
		).toEqual(['kiddo@example.com', 'parent@example.com']);
	});

	it('a parent copy that fails does not stop the child copy, and both are recorded', async () => {
		vi.useFakeTimers();
		const { t, clubId, childProfileId } = await seed({ confirmed: true, activityCopies: true });
		sendEmailMock.mockImplementation((async (email: { to: string }) => {
			if (email.to === 'parent@example.com') throw new Error('Resend send failed: 500');
			return { providerMessageId: 'resend-msg-1' };
		}) as never);
		await cancelSessionForChild(t, clubId);
		sendEmailMock.mockImplementation(async () => {});

		const deliveries = await deliveriesFor(t, childProfileId);
		expect(
			deliveries.map((row) => [row.audience, row.status]).sort((a, b) => a[0]!.localeCompare(b[0]!))
		).toEqual([
			['parent', 'failed'],
			['self', 'sent']
		]);
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
		const rescheduledReminder = jobs.find((job) => job.scheduledTime === newStartTime - 24 * HOUR);
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
