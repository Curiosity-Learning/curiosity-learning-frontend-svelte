/// <reference types="vite/client" />

// Review S9: a parent who signed in with a different email than the one that approved their
// child (account B, unlinked) can ask for a sign-in link to "the address that approved" from the
// child page — resolved server-side, never revealed, same answer whether or not a consent exists,
// rate-limited per (caller, child). Plus the edge case 4 reminder: a parent-entered child address
// still pending after 3 days gets one reminder email to the parent. Mounts the real betterAuth
// component: sign-in links are minted through it.

import betterAuthTest from '@convex-dev/better-auth/test';
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, components, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { CHILD_EMAIL_REMINDER_AFTER_MS } from './childEmailVerification';
import schema from './schema';
import { parseMagicLinkInterstitialFragment } from '../lib/auth/magic-link';

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

const DAY = 24 * 60 * 60 * 1000;

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

const createAuthUser = async (t: ReturnType<typeof convexTest>, email: string) => {
	const now = Date.now();
	const user = (await t.mutation(components.betterAuth.adapter.create, {
		input: {
			model: 'user',
			data: { email, emailVerified: true, name: email, createdAt: now, updatedAt: now }
		}
	})) as { _id: string };
	return user._id;
};

const insertProfile = (t: ReturnType<typeof convexTest>, authUserId: string, username: string) =>
	t.run((ctx) =>
		ctx.db.insert('profiles', {
			authUserId,
			username,
			isVerified: true,
			firstLoginCompleted: true,
			updatedAt: Date.now()
		})
	);

const insertConsent = (
	t: ReturnType<typeof convexTest>,
	args: {
		childProfileId: Id<'profiles'>;
		parentProfileId?: Id<'profiles'>;
		parentEmail: string;
		unlinked?: boolean;
	}
) =>
	t.run(async (ctx) => {
		const now = Date.now();
		await ctx.db.insert('parentChildConsents', {
			childProfileId: args.childProfileId,
			parentProfileId: args.parentProfileId,
			parentEmail: args.parentEmail,
			status: 'approved',
			token: `consent-${args.childProfileId}`,
			approvedAt: now,
			createdAt: now,
			updatedAt: now,
			...(args.unlinked ? { unlinkedAt: now } : {})
		});
		if (args.parentProfileId && !args.unlinked) {
			await ctx.db.insert('parentLinks', {
				parentProfileId: args.parentProfileId,
				childProfileId: args.childProfileId,
				createdAt: now
			});
		}
	});

const verificationRowCount = async (t: ReturnType<typeof convexTest>) =>
	(
		(await t.query(components.betterAuth.adapter.findMany, {
			model: 'verification',
			paginationOpts: { cursor: null, numItems: 100 }
		})) as { page: unknown[] }
	).page.length;

const settle = (t: ReturnType<typeof convexTest>) => t.finishAllScheduledFunctions(vi.runAllTimers);
const sent = () => sendEmailMock.mock.calls.map(([email]) => email);

const setup = async () => {
	const t = convexTest(schema, modules);
	betterAuthTest.register(t);
	// Account A: created password-less at consent approval under the consent address.
	const approvingUserId = await createAuthUser(t, 'parent@example.com');
	// Account B: the same person, signed up later with another address.
	const otherUserId = await createAuthUser(t, 'parent.work@example.com');
	const childUserId = await createAuthUser(t, 'kiddo@children.curiosity.local');
	const approvingProfileId = await insertProfile(t, approvingUserId, 'parenta');
	await insertProfile(t, otherUserId, 'parentb');
	const childProfileId = await insertProfile(t, childUserId, 'kiddo');
	const loneChildUserId = await createAuthUser(t, 'lone@children.curiosity.local');
	const loneChildProfileId = await insertProfile(t, loneChildUserId, 'lone');
	await insertConsent(t, {
		childProfileId,
		parentProfileId: approvingProfileId,
		parentEmail: 'parent@example.com'
	});
	vi.useFakeTimers();
	return {
		t,
		childProfileId,
		loneChildProfileId,
		approving: t.withIdentity({ subject: approvingUserId }),
		other: t.withIdentity({ subject: otherUserId }),
		child: t.withIdentity({ subject: childUserId })
	};
};

describe('requestApprovingAccountSignInLink (review S9)', () => {
	it('emails a 30-minute sign-in link to the approving address, never revealing it to the caller', async () => {
		const { t, other, childProfileId } = await setup();
		const result = await other.mutation(api.parentAccounts.requestApprovingAccountSignInLink, {
			childProfileId
		});
		expect(result).toEqual({ status: 'requested' });
		expect(JSON.stringify(result)).not.toMatch(/parent@|p…@/);
		// The account B is not linked, and stays unlinked: the link signs in as A.
		expect(await other.query(api.parentAccounts.getMyLinkedChildren, {})).toEqual([]);

		await settle(t);
		const emails = sent();
		expect(emails.map((email) => [email.to, email.type, email.subject])).toEqual([
			['parent@example.com', 'magic-link', 'Your sign-in link']
		]);
		expect(emails[0].text).toContain('This link works once and expires in 30 minutes.');
		const [row] = (
			(await t.query(components.betterAuth.adapter.findMany, {
				model: 'verification',
				paginationOpts: { cursor: null, numItems: 10 }
			})) as { page: { expiresAt: number; createdAt: number }[] }
		).page;
		expect(row.expiresAt - row.createdAt).toBe(30 * 60 * 1000);
		const raw = emails[0].text.match(/https:\/\/app\.example\.com\/auth\/link#\S+/)![0];
		expect(parseMagicLinkInterstitialFragment(new URL(raw).hash)?.next).toBe(
			`/child/${childProfileId}`
		);
		expect(await verificationRowCount(t)).toBe(1);
		const deliveries = await t.run((ctx) => ctx.db.query('emailDeliveries').collect());
		expect(deliveries).toEqual([
			expect.objectContaining({
				recipientProfileId: childProfileId,
				to: 'parent@example.com',
				kind: 'approving_account_sign_in_link',
				audience: 'parent',
				status: 'sent'
			})
		]);
	});

	it('answers the same, and sends nothing, when there is no consent to resolve or no one else to email', async () => {
		const { t, other, approving, child, childProfileId, loneChildProfileId } = await setup();
		// No approved consent behind this child.
		expect(
			await other.mutation(api.parentAccounts.requestApprovingAccountSignInLink, {
				childProfileId: loneChildProfileId
			})
		).toEqual({ status: 'requested' });
		// The caller already is the approving address.
		expect(
			await approving.mutation(api.parentAccounts.requestApprovingAccountSignInLink, {
				childProfileId
			})
		).toEqual({ status: 'requested' });
		// A child account never triggers an email to its parent this way.
		expect(
			await child.mutation(api.parentAccounts.requestApprovingAccountSignInLink, {
				childProfileId
			})
		).toEqual({ status: 'requested' });
		await settle(t);
		expect(sendEmailMock).not.toHaveBeenCalled();
		expect(await verificationRowCount(t)).toBe(0);
	});

	it('never emails a parent the child has unlinked', async () => {
		const { t, other, loneChildProfileId } = await setup();
		await insertConsent(t, {
			childProfileId: loneChildProfileId,
			parentEmail: 'parent@example.com',
			unlinked: true
		});
		expect(
			await other.mutation(api.parentAccounts.requestApprovingAccountSignInLink, {
				childProfileId: loneChildProfileId
			})
		).toEqual({ status: 'requested' });
		await settle(t);
		expect(sendEmailMock).not.toHaveBeenCalled();
	});

	it('is limited to 3 per (caller, child) per day, counted whether or not a consent exists', async () => {
		const { t, other, childProfileId, loneChildProfileId } = await setup();
		for (const target of [childProfileId, loneChildProfileId]) {
			for (let attempt = 0; attempt < 3; attempt++) {
				expect(
					await other.mutation(api.parentAccounts.requestApprovingAccountSignInLink, {
						childProfileId: target
					})
				).toEqual({ status: 'requested' });
			}
			expect(
				await other.mutation(api.parentAccounts.requestApprovingAccountSignInLink, {
					childProfileId: target
				})
			).toEqual({ status: 'rateLimited' });
		}
		await settle(t);
		expect(sent()).toHaveLength(3);
		vi.setSystemTime(Date.now() + DAY + 1000);
		expect(
			await other.mutation(api.parentAccounts.requestApprovingAccountSignInLink, {
				childProfileId
			})
		).toEqual({ status: 'requested' });
	});
	it('sends at most 3 links per consent per day, whoever asks (review S4), still answering requested', async () => {
		const { t, other, childProfileId } = await setup();
		const thirdUserId = await createAuthUser(t, 'stranger@example.com');
		await insertProfile(t, thirdUserId, 'stranger');
		const stranger = t.withIdentity({ subject: thirdUserId });
		for (const caller of [other, stranger]) {
			for (let attempt = 0; attempt < 3; attempt++) {
				expect(
					await caller.mutation(api.parentAccounts.requestApprovingAccountSignInLink, {
						childProfileId
					})
				).toEqual({ status: 'requested' });
			}
		}
		await settle(t);
		expect(sent().map((email) => email.to)).toEqual([
			'parent@example.com',
			'parent@example.com',
			'parent@example.com'
		]);
		vi.setSystemTime(Date.now() + DAY + 1000);
		await stranger.mutation(api.parentAccounts.requestApprovingAccountSignInLink, {
			childProfileId
		});
		await settle(t);
		expect(sent()).toHaveLength(4);
	});
});

describe('pending child email reminder (review edge case 4)', () => {
	const setPending = (
		t: ReturnType<typeof convexTest>,
		childProfileId: Id<'profiles'>,
		options: { ageMs: number; source?: 'childPage' | 'self'; verified?: boolean }
	) =>
		t.run((ctx) =>
			ctx.db.patch(childProfileId, {
				notificationEmail: 'kiddo@example.com',
				notificationEmailSetAt: Date.now() - options.ageMs,
				notificationEmailSource: options.source ?? 'childPage',
				...(options.verified ? { notificationEmailVerifiedAt: Date.now() } : {})
			})
		);
	const runCron = (t: ReturnType<typeof convexTest>) =>
		t.mutation(internal.childEmailVerification.schedulePendingEmailReminders, {});

	it('reminds the parent once about an address pending for 3+ days, with a plain link', async () => {
		const { t, childProfileId } = await setup();
		await setPending(t, childProfileId, { ageMs: CHILD_EMAIL_REMINDER_AFTER_MS + 4 * DAY });
		expect(await runCron(t)).toEqual({ scheduled: 1, hasMore: false });
		await settle(t);
		const emails = sent();
		expect(emails.map((email) => [email.to, email.subject])).toEqual([
			['parent@example.com', "kiddo hasn't confirmed their email address yet"]
		]);
		expect(emails[0].text).toContain('We sent a confirmation link to kiddo@example.com 7 days ago');
		expect(emails[0].text).toContain(`https://app.example.com/child/${childProfileId}`);
		expect(emails[0].text).not.toMatch(/auth\/link/);
		const [delivery] = await t.run((ctx) => ctx.db.query('emailDeliveries').collect());
		expect(delivery).toMatchObject({ kind: 'child_email_reminder', audience: 'parent' });

		// Once per address.
		sendEmailMock.mockClear();
		expect(await runCron(t)).toEqual({ scheduled: 0, hasMore: false });
		await settle(t);
		expect(sendEmailMock).not.toHaveBeenCalled();
	});

	it('skips young, confirmed and self-entered addresses; a new address can be reminded again', async () => {
		const { t, childProfileId } = await setup();
		await setPending(t, childProfileId, { ageMs: CHILD_EMAIL_REMINDER_AFTER_MS - DAY });
		expect(await runCron(t)).toEqual({ scheduled: 0, hasMore: false });
		await setPending(t, childProfileId, { ageMs: 10 * DAY, verified: true });
		expect(await runCron(t)).toEqual({ scheduled: 0, hasMore: false });

		await t.run((ctx) => ctx.db.patch(childProfileId, { notificationEmailVerifiedAt: undefined }));
		await setPending(t, childProfileId, { ageMs: 10 * DAY, source: 'self' });
		expect(await runCron(t)).toEqual({ scheduled: 0, hasMore: false });
		// Stamped anyway, so the cron does not look at it again.
		expect(
			(await t.run((ctx) => ctx.db.get(childProfileId)))?.notificationEmailReminderSentAt
		).toEqual(expect.any(Number));
		await settle(t);
		expect(sendEmailMock).not.toHaveBeenCalled();

		// A new address starts unstamped (the setters clear it, childEmailVerification.spec.ts).
		await t.run((ctx) =>
			ctx.db.patch(childProfileId, {
				notificationEmail: 'kiddo2@example.com',
				notificationEmailSource: 'childPage',
				notificationEmailSetAt: Date.now() - 4 * DAY,
				notificationEmailReminderSentAt: undefined
			})
		);
		expect(await runCron(t)).toEqual({ scheduled: 1, hasMore: false });
	});
});
