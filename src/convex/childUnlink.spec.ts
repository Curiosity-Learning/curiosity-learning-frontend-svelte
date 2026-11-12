/// <reference types="vite/client" />

// CL-769 (review S7/D4, edge case 13): a child aged 16+ owns their own notification email
// (parentAccounts.setMyNotificationEmail, the same pending -> confirm flow as a parent-entered
// address), may only unlink their parent once that address is confirmed, and after unlinking
// is in effect an independent user: every email about them goes to their own address, nothing
// to the parent (critical notices included), no sign-in link is minted for the parent, and the
// parent gets one final plain notice. Mounts the real betterAuth component: the fresh-sign-in
// rule reads the session row, routing reads auth emails, and minted sign-in links are
// `verification` rows we can count.

import betterAuthTest from '@convex-dev/better-auth/test';
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, components } from './_generated/api';
import { dispatchNotification } from './notificationsModel';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

type SentEmail = { to: string; type: string; subject: string; text: string; html: string };

const { sendEmailMock } = vi.hoisted(() => ({
	sendEmailMock: vi.fn<(email: SentEmail) => Promise<{ providerMessageId: string }>>(async () => ({
		providerMessageId: 'resend-msg-1'
	}))
}));

vi.mock('./email/resend', () => ({
	sendEmail: sendEmailMock
}));

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

beforeEach(() => {
	vi.stubEnv('BETTER_AUTH_URL', 'https://app.example.com');
	vi.stubEnv('CONVEX_SITE_URL', 'https://site.example.com');
	vi.stubEnv('BETTER_AUTH_SECRET', 'test-secret-'.repeat(4));
	sendEmailMock.mockClear();
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
});

// "YYYY-MM" for a birth month `monthsAgo` months before now.
const birthMonth = (monthsAgo: number) => {
	const now = new Date();
	const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, 1));
	return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
};
// 16 from the first day of this month (the permissive reading, parentAccounts.ts).
const SIXTEEN = () => birthMonth(16 * 12);
// Turns 16 next month.
const FIFTEEN = () => birthMonth(16 * 12 - 1);

const createAuthUser = async (t: ReturnType<typeof convexTest>, email: string, name: string) => {
	const now = Date.now();
	const user = (await t.mutation(components.betterAuth.adapter.create, {
		input: {
			model: 'user',
			data: { email, emailVerified: true, name, createdAt: now, updatedAt: now }
		}
	})) as { _id: string };
	return user._id;
};

// A session row as a username+password sign-in would create, `ageMs` old.
const createSession = async (t: ReturnType<typeof convexTest>, userId: string, ageMs = 0) => {
	const now = Date.now();
	const session = (await t.mutation(components.betterAuth.adapter.create, {
		input: {
			model: 'session',
			data: {
				token: `session-${userId}-${ageMs}`,
				userId,
				expiresAt: now + DAY,
				createdAt: now - ageMs,
				updatedAt: now
			}
		}
	})) as { _id: string };
	return session._id;
};

const verificationRowCount = async (t: ReturnType<typeof convexTest>) =>
	(
		(await t.query(components.betterAuth.adapter.findMany, {
			model: 'verification',
			paginationOpts: { cursor: null, numItems: 100 }
		})) as { page: unknown[] }
	).page.length;

const setup = async (options: { dateOfBirth: string }) => {
	const t = convexTest(schema, modules);
	betterAuthTest.register(t);
	const parentUserId = await createAuthUser(t, 'parent@example.com', 'parent');
	const childUserId = await createAuthUser(t, 'teen@children.curiosity.local', 'teen');
	const guideUserId = await createAuthUser(t, 'guide@example.com', 'guide');
	const ids = await t.run(async (ctx) => {
		const now = Date.now();
		const parentProfileId = await ctx.db.insert('profiles', {
			authUserId: parentUserId,
			username: 'parentuser',
			isVerified: true,
			firstLoginCompleted: true,
			updatedAt: now
		});
		const childProfileId = await ctx.db.insert('profiles', {
			authUserId: childUserId,
			username: 'teen',
			dateOfBirth: options.dateOfBirth,
			isVerified: true,
			firstLoginCompleted: true,
			updatedAt: now
		});
		const guideProfileId = await ctx.db.insert('profiles', {
			authUserId: guideUserId,
			firstName: 'Gina',
			isVerified: true,
			firstLoginCompleted: true,
			updatedAt: now
		});
		await ctx.db.insert('parentChildConsents', {
			childProfileId,
			parentProfileId,
			parentEmail: 'parent@example.com',
			status: 'approved',
			token: 'consent-teen',
			approvedAt: now,
			createdAt: now,
			updatedAt: now
		});
		await ctx.db.insert('parentLinks', { parentProfileId, childProfileId, createdAt: now });
		// The parent had opted into every copy: unlinking must end those too.
		await ctx.db.insert('parentNotificationSettings', {
			parentProfileId,
			childProfileId,
			chatCopies: true,
			activityCopies: true,
			updatedAt: now
		});
		const roleId = await ctx.db.insert('clubRoles', {
			key: 'learner',
			name: 'Learner',
			permissions: ['club:read'],
			order: 0,
			createdAt: now - 30 * DAY
		});
		const clubId = await ctx.db.insert('clubs', {
			name: 'Curiosity Club',
			discoverable: false,
			createdByProfileId: guideProfileId,
			createdAt: now - 30 * DAY,
			updatedAt: now
		});
		const roomId = await ctx.db.insert('rooms', { contextType: 'club', clubId });
		for (const profileId of [guideProfileId, childProfileId]) {
			await ctx.db.insert('clubMembers', { clubId, profileId, roleId, createdAt: now - 30 * DAY });
		}
		return { parentProfileId, childProfileId, clubId, roomId };
	});
	const childSessionId = await createSession(t, childUserId);
	vi.useFakeTimers();
	return {
		t,
		...ids,
		child: t.withIdentity({ subject: childUserId, sessionId: childSessionId }),
		parent: t.withIdentity({ subject: parentUserId }),
		guide: t.withIdentity({ subject: guideUserId }),
		childUserId
	};
};

const settle = (t: ReturnType<typeof convexTest>) => t.finishAllScheduledFunctions(vi.runAllTimers);
const sent = () => sendEmailMock.mock.calls.map(([email]) => email);
const sentTo = (address: string) => sent().filter((email) => email.to === address);
const latestToken = () => {
	const email = sent()
		.filter((candidate) => candidate.type === 'child-email-verification')
		.at(-1)!;
	return /https:\/\/app\.example\.com\/verify-email\/([a-zA-Z]+)/.exec(email.text)![1];
};

// Sets and confirms the teen's own address.
const confirmOwnEmail = async (fixture: Awaited<ReturnType<typeof setup>>) => {
	await fixture.child.mutation(api.parentAccounts.setMyNotificationEmail, {
		email: 'teen@example.com'
	});
	await settle(fixture.t);
	await fixture.child.mutation(api.childEmailVerification.confirmChildEmail, {
		token: latestToken()
	});
	await settle(fixture.t);
};

describe('setMyNotificationEmail: the 16+ child owns their own address', () => {
	it('is not offered to, and refused for, a child who is not 16 yet', async () => {
		const { child } = await setup({ dateOfBirth: FIFTEEN() });
		expect(await child.query(api.parentAccounts.getMyNotificationEmail, {})).toBeNull();
		await expect(
			child.mutation(api.parentAccounts.setMyNotificationEmail, { email: 'teen@example.com' })
		).rejects.toThrow('Only accounts aged 16 or older');
		expect(sendEmailMock).not.toHaveBeenCalled();
	});

	it('is refused for an adult account (no synthetic child email)', async () => {
		const { parent } = await setup({ dateOfBirth: SIXTEEN() });
		expect(await parent.query(api.parentAccounts.getMyNotificationEmail, {})).toBeNull();
	});

	it('at 16: pending, confirmation email worded for the teen, parent told, then confirmed', async () => {
		const fixture = await setup({ dateOfBirth: SIXTEEN() });
		const { t, child, childProfileId } = fixture;
		expect(await child.query(api.parentAccounts.getMyNotificationEmail, {})).toEqual({
			notificationEmail: null,
			status: 'none',
			setAt: null,
			hasLinkedParent: true
		});

		const result = await child.mutation(api.parentAccounts.setMyNotificationEmail, {
			email: 'Teen@Example.com'
		});
		expect(result).toEqual({
			notificationEmail: 'teen@example.com',
			status: 'pending',
			verificationSent: true
		});
		await settle(t);
		const profile = await t.run((ctx) => ctx.db.get(childProfileId));
		expect(profile?.notificationEmailSource).toBe('self');
		expect(profile?.notificationEmailSetByProfileId).toBe(childProfileId);
		const [verify] = sentTo('teen@example.com');
		expect(verify.text).toContain(
			'You added this address for Curiosity Learning notifications for the account teen.'
		);
		const [row] = await t.run((ctx) => ctx.db.query('childEmailVerifications').collect());
		expect(row.requestedByProfileId).toBe(childProfileId);
		expect(
			await child.query(api.childEmailVerification.getChildEmailVerification, {
				token: latestToken()
			})
		).toMatchObject({ status: 'valid', addedBySelf: true });
		// The linked parent hears about it, as for any routing change (review S5).
		expect(sentTo('parent@example.com').map((email) => email.text)).toEqual([
			expect.stringContaining(
				"teen's notification emails will go to teen@example.com once teen confirms it."
			)
		]);

		await child.mutation(api.childEmailVerification.confirmChildEmail, { token: latestToken() });
		expect((await child.query(api.parentAccounts.getMyNotificationEmail, {}))?.status).toBe(
			'verified'
		);
	});

	it("refuses the parent's address and a stale session", async () => {
		const { t, child, childUserId } = await setup({ dateOfBirth: SIXTEEN() });
		await expect(
			child.mutation(api.parentAccounts.setMyNotificationEmail, { email: 'Parent@example.com' })
		).rejects.toThrow('NOTIFICATION_EMAIL_IS_PARENT');
		vi.useRealTimers();
		const staleSessionId = await createSession(t, childUserId, 20 * MINUTE);
		await expect(
			t
				.withIdentity({ subject: childUserId, sessionId: staleSessionId })
				.mutation(api.parentAccounts.setMyNotificationEmail, { email: 'teen@example.com' })
		).rejects.toThrow('FRESH_SESSION_REQUIRED');
	});
});

describe('unlinkParent requires a confirmed own address (review D4)', () => {
	it('is refused without an address and while it is pending, allowed once confirmed', async () => {
		const fixture = await setup({ dateOfBirth: SIXTEEN() });
		const { t, child, parentProfileId } = fixture;
		await expect(
			child.mutation(api.parentAccounts.unlinkParent, { parentProfileId })
		).rejects.toThrow('UNLINK_REQUIRES_CONFIRMED_EMAIL');

		await child.mutation(api.parentAccounts.setMyNotificationEmail, { email: 'teen@example.com' });
		await settle(t);
		await expect(
			child.mutation(api.parentAccounts.unlinkParent, { parentProfileId })
		).rejects.toThrow('UNLINK_REQUIRES_CONFIRMED_EMAIL');
		expect(await child.query(api.parentAccounts.getMyParentLink, {})).not.toBeNull();

		await child.mutation(api.childEmailVerification.confirmChildEmail, { token: latestToken() });
		await child.mutation(api.parentAccounts.unlinkParent, { parentProfileId });
		expect(await child.query(api.parentAccounts.getMyParentLink, {})).toBeNull();
	});

	it('sends the parent one final plain notice, deletes their settings, and removing the address is then refused', async () => {
		const fixture = await setup({ dateOfBirth: SIXTEEN() });
		const { t, child, parent, parentProfileId, childProfileId } = fixture;
		await confirmOwnEmail(fixture);
		sendEmailMock.mockClear();

		await child.mutation(api.parentAccounts.unlinkParent, { parentProfileId });
		await settle(t);
		// Called again (a double click): nothing is unlinked, nothing is sent.
		await child.mutation(api.parentAccounts.unlinkParent, { parentProfileId });
		await settle(t);

		const notices = sentTo('parent@example.com');
		expect(notices).toHaveLength(1);
		expect(notices[0].subject).toBe('teen has unlinked your parent account');
		expect(notices[0].text).toBe(
			'teen has unlinked your parent account. You will no longer receive emails about teen.'
		);
		expect(notices[0].html).not.toMatch(/href=/);
		const deliveries = await t.run((ctx) =>
			ctx.db
				.query('emailDeliveries')
				.withIndex('by_recipient', (q) => q.eq('recipientProfileId', childProfileId))
				.collect()
		);
		expect(deliveries.filter((row) => row.kind === 'parent_unlinked')).toEqual([
			expect.objectContaining({ to: 'parent@example.com', audience: 'parent', status: 'sent' })
		]);
		expect(await t.run((ctx) => ctx.db.query('parentNotificationSettings').collect())).toEqual([]);
		// The unlinked parent cannot claim the link back.
		expect((await parent.mutation(api.parentAccounts.syncParentLinks, {})).linkedCount).toBe(0);

		expect(
			(await child.query(api.parentAccounts.getMyNotificationEmail, {}))?.hasLinkedParent
		).toBe(false);
		await expect(
			child.mutation(api.parentAccounts.setMyNotificationEmail, { email: null })
		).rejects.toThrow('OWN_EMAIL_REQUIRED');
	});
});

describe('routing after unlink (review S7): the teen only, nothing to the parent', () => {
	const unlinked = async () => {
		const fixture = await setup({ dateOfBirth: SIXTEEN() });
		await confirmOwnEmail(fixture);
		await fixture.child.mutation(api.parentAccounts.unlinkParent, {
			parentProfileId: fixture.parentProfileId
		});
		await settle(fixture.t);
		sendEmailMock.mockClear();
		expect(await verificationRowCount(fixture.t)).toBe(0);
		return fixture;
	};

	it('critical notices go to the teen only, and no sign-in link is minted', async () => {
		const { t, childProfileId } = await unlinked();
		await t.run((ctx) =>
			dispatchNotification(ctx, {
				recipientProfileId: childProfileId,
				kind: 'application_status',
				title: 'Application update',
				message: 'Your club application was approved.'
			})
		);
		await settle(t);
		expect(sent().map((email) => email.to)).toEqual(['teen@example.com']);
		expect(sent()[0].text).not.toMatch(/auth\/link/);
		expect(await verificationRowCount(t)).toBe(0);
	});

	it("other high kinds go to the teen, subject to the teen's own mute, never as a parent copy", async () => {
		const { t, childProfileId } = await unlinked();
		const dispatchCancelled = () =>
			t.run((ctx) =>
				dispatchNotification(ctx, {
					recipientProfileId: childProfileId,
					kind: 'session_cancelled',
					title: 'Session cancelled',
					message: 'The session was cancelled.'
				})
			);
		await dispatchCancelled();
		await settle(t);
		expect(sent().map((email) => email.to)).toEqual(['teen@example.com']);

		sendEmailMock.mockClear();
		await t.run((ctx) =>
			ctx.db.insert('userPreferences', {
				profileId: childProfileId,
				theme: 'system',
				notificationsEnabled: false,
				notificationPreferences: {
					clubMemberChanges: false,
					projectDeadlineReminder: false,
					projectMemberAdded: false,
					projectCompleted: false,
					sessionReminder: false,
					sessionActivityChanges: false,
					updateLikes: false,
					updateComments: false,
					chatMessages: false
				},
				updatedAt: Date.now()
			})
		);
		await dispatchCancelled();
		await settle(t);
		expect(sendEmailMock).not.toHaveBeenCalled();
	});

	it('club chat goes to the teen only, without a parent copy or a sign-in link', async () => {
		const { t, guide, roomId } = await unlinked();
		await guide.mutation(api.chat.sendMessage, { roomId, content: 'Hello everyone' });
		await settle(t);
		expect(sent().map((email) => email.to)).toEqual(['teen@example.com']);
		expect(await verificationRowCount(t)).toBe(0);
	});
});

describe("a child's date of birth is immutable (review B1: the 16+ gate depends on it)", () => {
	it('updateMe refuses a new date of birth from a 15-year-old, who still cannot own an email or unlink', async () => {
		const { t, child, childProfileId, parentProfileId } = await setup({ dateOfBirth: FIFTEEN() });
		await expect(child.mutation(api.profiles.updateMe, { dateOfBirth: '2000-01' })).rejects.toThrow(
			"A child account's date of birth can't be changed"
		);
		// Resending the stored value (or omitting it) is fine.
		await child.mutation(api.profiles.updateMe, { dateOfBirth: FIFTEEN(), about: 'hi' });
		expect((await t.run((ctx) => ctx.db.get(childProfileId)))?.dateOfBirth).toBe(FIFTEEN());

		expect((await child.query(api.parentAccounts.getMyParentLink, {}))?.canUnlink).toBe(false);
		await expect(
			child.mutation(api.parentAccounts.setMyNotificationEmail, { email: 'teen@example.com' })
		).rejects.toThrow('Only accounts aged 16 or older');
		await expect(
			child.mutation(api.parentAccounts.unlinkParent, { parentProfileId })
		).rejects.toThrow();
	});

	it('completeSignupProfile refuses it too', async () => {
		const { t, child, childProfileId } = await setup({ dateOfBirth: FIFTEEN() });
		await expect(
			child.mutation(api.auth.completeSignupProfile, {
				signUpWith: 'email',
				dateOfBirth: '2000-01'
			})
		).rejects.toThrow("A child account's date of birth can't be changed");
		expect((await t.run((ctx) => ctx.db.get(childProfileId)))?.dateOfBirth).toBe(FIFTEEN());
	});

	it('a child without a stored date of birth cannot set one', async () => {
		const { t, child, childProfileId } = await setup({ dateOfBirth: FIFTEEN() });
		await t.run((ctx) => ctx.db.patch(childProfileId, { dateOfBirth: undefined }));
		await expect(child.mutation(api.profiles.updateMe, { dateOfBirth: '2000-01' })).rejects.toThrow(
			"A child account's date of birth can't be changed"
		);
	});

	it('an adult (here: the parent) can still edit theirs, in YYYY-MM format', async () => {
		const { t, parent, parentProfileId } = await setup({ dateOfBirth: FIFTEEN() });
		await parent.mutation(api.profiles.updateMe, { dateOfBirth: '1985-04' });
		expect((await t.run((ctx) => ctx.db.get(parentProfileId)))?.dateOfBirth).toBe('1985-04');
		await expect(
			parent.mutation(api.profiles.updateMe, { dateOfBirth: 'April 1985' })
		).rejects.toThrow('YYYY-MM');
	});
});
