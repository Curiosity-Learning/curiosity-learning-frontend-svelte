/// <reference types="vite/client" />

// CL-768 (review B2/B3/S5): a child notification email is pending until the CHILD confirms it
// while signed in as themselves; routing changes need a fresh parent sign-in and always email
// the parent a plain notice. Mounts the real betterAuth component: the fresh-sign-in rule reads
// the session row behind the caller's identity, and the parent's session is created through the
// real sign-in link route.

import betterAuthTest from '@convex-dev/better-auth/test';
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, components, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { mintMagicLink } from './magicLinks';
import schema from './schema';
import { CHILD_EMAIL_VERIFICATION_TTL_MS } from './childEmailVerification';
import {
	EMAIL_MAGIC_LINK_SECONDS,
	buildMagicLinkVerifyPath,
	parseMagicLinkInterstitialFragment
} from '../lib/auth/magic-link';

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

const insertProfile = (
	t: ReturnType<typeof convexTest>,
	authUserId: string,
	username: string
): Promise<Id<'profiles'>> =>
	t.run((ctx) =>
		ctx.db.insert('profiles', {
			authUserId,
			username,
			isVerified: true,
			firstLoginCompleted: true,
			updatedAt: Date.now()
		})
	);

const linkChild = (
	t: ReturnType<typeof convexTest>,
	args: { parentProfileId: Id<'profiles'>; childProfileId: Id<'profiles'>; parentEmail: string }
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
			updatedAt: now
		});
		await ctx.db.insert('parentLinks', {
			parentProfileId: args.parentProfileId,
			childProfileId: args.childProfileId,
			createdAt: now
		});
	});

const sessionCookie = (response: Response) =>
	response.headers
		.get('set-cookie')!
		.split(/,(?=\s*[\w.-]+=)/)
		.map((cookie) => cookie.trim().split(';')[0])
		.find((cookie) => /^(__Secure-)?better-auth\.session_token=/.test(cookie))!;

// Signs the parent in through the real sign-in link route (what a parent without a password
// does) and returns the session row that created.
const signInParentByLink = async (t: ReturnType<typeof convexTest>) => {
	const link = await t.run((ctx) =>
		mintMagicLink(ctx, {
			email: 'parent@example.com',
			callbackPath: '/settings',
			expiresInSeconds: EMAIL_MAGIC_LINK_SECONDS
		})
	);
	const parsed = parseMagicLinkInterstitialFragment(new URL(link!).hash)!;
	const verify = await t.fetch(buildMagicLinkVerifyPath(parsed), { method: 'GET' });
	expect(verify.status).toBe(302);
	const session = await t.fetch('/api/auth/get-session', {
		method: 'GET',
		headers: { cookie: sessionCookie(verify) }
	});
	const body = (await session.json()) as { session: { id: string; userId: string } };
	return body.session;
};

const ageSession = (t: ReturnType<typeof convexTest>, sessionId: string, ageMs: number) =>
	t.mutation(components.betterAuth.adapter.updateOne, {
		input: {
			model: 'session',
			where: [{ field: '_id', value: sessionId }],
			update: { createdAt: Date.now() - ageMs }
		}
	});

const setup = async () => {
	const t = convexTest(schema, modules);
	betterAuthTest.register(t);
	const parentUserId = await createAuthUser(t, 'parent@example.com', 'parent');
	const childUserId = await createAuthUser(t, 'kiddo@children.curiosity.local', 'kiddo');
	const siblingUserId = await createAuthUser(t, 'sib@children.curiosity.local', 'sib');
	const parentProfileId = await insertProfile(t, parentUserId, 'parentuser');
	const childProfileId = await insertProfile(t, childUserId, 'kiddo');
	const siblingProfileId = await insertProfile(t, siblingUserId, 'sib');
	await linkChild(t, { parentProfileId, childProfileId, parentEmail: 'parent@example.com' });
	await linkChild(t, {
		parentProfileId,
		childProfileId: siblingProfileId,
		parentEmail: 'parent@example.com'
	});
	// A club the child is in: its name must never appear in the confirmation email.
	await t.run(async (ctx) => {
		const now = Date.now();
		const roleId = await ctx.db.insert('clubRoles', {
			key: 'learner',
			name: 'Learner',
			permissions: [],
			order: 0,
			createdAt: now
		});
		const clubId = await ctx.db.insert('clubs', {
			name: 'Secret Robotics Club',
			discoverable: false,
			createdByProfileId: childProfileId,
			createdAt: now,
			updatedAt: now
		});
		await ctx.db.insert('clubMembers', {
			clubId,
			profileId: childProfileId,
			roleId,
			createdAt: now
		});
	});

	const session = await signInParentByLink(t);
	expect(session.userId).toBe(parentUserId);
	vi.useFakeTimers();
	sendEmailMock.mockClear();
	return {
		t,
		parentProfileId,
		childProfileId,
		siblingProfileId,
		sessionId: session.id,
		parent: t.withIdentity({ subject: parentUserId, sessionId: session.id }),
		child: t.withIdentity({ subject: childUserId }),
		sibling: t.withIdentity({ subject: siblingUserId })
	};
};

const settle = (t: ReturnType<typeof convexTest>) => t.finishAllScheduledFunctions(vi.runAllTimers);

const sent = () => sendEmailMock.mock.calls.map(([email]) => email);
const verificationEmails = () =>
	sent().filter((email) => email.type === 'child-email-verification');
const noticeEmails = () => sent().filter((email) => email.to === 'parent@example.com');
const tokenFrom = (email: SentEmail) =>
	/https:\/\/app\.example\.com\/verify-email\/([a-zA-Z]+)/.exec(email.text)![1];
const latestToken = () => tokenFrom(verificationEmails().at(-1)!);

describe('setChildNotificationEmail: pending address and its confirmation email', () => {
	it('stores the address as pending and emails it a minimal confirmation link', async () => {
		const { t, parent, childProfileId } = await setup();

		const result = await parent.mutation(api.parentAccounts.setChildNotificationEmail, {
			childProfileId,
			email: 'Kiddo@Example.com'
		});
		expect(result).toEqual({
			notificationEmail: 'kiddo@example.com',
			status: 'pending',
			verificationSent: true
		});
		await settle(t);

		const child = await t.run((ctx) => ctx.db.get(childProfileId));
		expect(child?.notificationEmail).toBe('kiddo@example.com');
		expect(child?.notificationEmailVerifiedAt).toBeUndefined();
		expect(child?.notificationEmailSource).toBe('childPage');

		const [verify] = verificationEmails();
		expect(verify.to).toBe('kiddo@example.com');
		expect(verify.subject).toBe('Confirm your email for Curiosity Learning');
		expect(verify.text).toContain(
			'Your parent or guardian added this address for Curiosity Learning notifications for the account kiddo. Sign in as kiddo to confirm it.'
		);
		expect(verify.text).toContain("If you don't know what this is, you can ignore this email.");
		expect(verify.html).toContain('Confirm this email');
		// No club names, no sign-in link, and no link other than the confirmation page.
		for (const body of [verify.text, verify.html]) {
			expect(body).not.toContain('Secret Robotics Club');
			expect(body).not.toMatch(/auth\/link|magic-link/);
		}
		const links = new Set([...verify.html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]));
		expect([...links]).toEqual([`https://app.example.com/verify-email/${tokenFrom(verify)}`]);

		// Only the hash is stored, and the token never passed through scheduler args.
		const rows = await t.run((ctx) => ctx.db.query('childEmailVerifications').collect());
		expect(rows).toHaveLength(1);
		expect(rows[0].tokenHash).toEqual(expect.any(String));
		expect(rows[0].tokenHash).not.toBe(tokenFrom(verify));
		expect(rows[0].expiresAt - rows[0].createdAt).toBe(CHILD_EMAIL_VERIFICATION_TTL_MS);
		const scheduled = await t.run((ctx) => ctx.db.system.query('_scheduled_functions').collect());
		expect(JSON.stringify(scheduled.map((job) => job.args))).not.toContain(tokenFrom(verify));
	});

	it('emails the parent a plain notice (no sign-in link) and logs both emails', async () => {
		const { t, parent, childProfileId } = await setup();
		await parent.mutation(api.parentAccounts.setChildNotificationEmail, {
			childProfileId,
			email: 'kiddo@example.com'
		});
		await settle(t);

		const [notice] = noticeEmails();
		expect(notice.text).toContain(
			"kiddo's notification emails will go to k…@example.com once kiddo confirms it."
		);
		expect(notice.text).toContain("Not you? Open kiddo's page to undo.");
		expect(notice.text).toContain(`https://app.example.com/child/${childProfileId}`);
		expect(notice.text).not.toMatch(/auth\/link|magic-link/);
		expect(notice.html).not.toMatch(/auth\/link|magic-link/);
		expect(notice.text).not.toContain('kiddo@example.com');

		const deliveries = await t.run((ctx) => ctx.db.query('emailDeliveries').collect());
		expect(deliveries.map((row) => [row.kind, row.to, row.status]).sort()).toEqual([
			['child_email_verification', 'kiddo@example.com', 'sent'],
			['child_routing_changed', 'parent@example.com', 'sent']
		]);
	});

	it("rejects the parent's own address, both their sign-in email and the consent address", async () => {
		const { t, parent, childProfileId } = await setup();
		await expect(
			parent.mutation(api.parentAccounts.setChildNotificationEmail, {
				childProfileId,
				email: ' Parent@Example.com '
			})
		).rejects.toThrow(/NOTIFICATION_EMAIL_IS_PARENT/);

		// The consent address can differ from the parent's sign-in email (review S9).
		await t.run(async (ctx) => {
			const consent = await ctx.db
				.query('parentChildConsents')
				.withIndex('by_child_profile_id', (q) => q.eq('childProfileId', childProfileId))
				.unique();
			await ctx.db.patch(consent!._id, { parentEmail: 'guardian@example.com' });
		});
		await expect(
			parent.mutation(api.parentAccounts.setChildNotificationEmail, {
				childProfileId,
				email: 'guardian@example.com'
			})
		).rejects.toThrow(/NOTIFICATION_EMAIL_IS_PARENT/);
		await settle(t);
		expect(sendEmailMock).not.toHaveBeenCalled();
	});

	it('allows siblings to share one address; each child confirms for themselves', async () => {
		const { t, parent, child, sibling, childProfileId, siblingProfileId } = await setup();
		await parent.mutation(api.parentAccounts.setChildNotificationEmail, {
			childProfileId,
			email: 'family@example.com'
		});
		await settle(t);
		const childToken = latestToken();
		await parent.mutation(api.parentAccounts.setChildNotificationEmail, {
			childProfileId: siblingProfileId,
			email: 'family@example.com'
		});
		await settle(t);
		const siblingToken = latestToken();
		expect(siblingToken).not.toBe(childToken);

		await child.mutation(api.childEmailVerification.confirmChildEmail, { token: childToken });
		const [kid, sib] = await t.run(async (ctx) => [
			await ctx.db.get(childProfileId),
			await ctx.db.get(siblingProfileId)
		]);
		expect(kid?.notificationEmailVerifiedAt).toEqual(expect.any(Number));
		expect(sib?.notificationEmailVerifiedAt).toBeUndefined();
		// The sibling cannot confirm with the other child's link.
		await expect(
			sibling.mutation(api.childEmailVerification.confirmChildEmail, { token: childToken })
		).rejects.toThrow(/different account/);
		await sibling.mutation(api.childEmailVerification.confirmChildEmail, { token: siblingToken });
	});

	it('changing a confirmed address resets the confirmation and sends a new link', async () => {
		const { t, parent, child, childProfileId } = await setup();
		await parent.mutation(api.parentAccounts.setChildNotificationEmail, {
			childProfileId,
			email: 'kiddo@example.com'
		});
		await settle(t);
		await child.mutation(api.childEmailVerification.confirmChildEmail, { token: latestToken() });

		await parent.mutation(api.parentAccounts.setChildNotificationEmail, {
			childProfileId,
			email: 'kiddo.new@example.com'
		});
		await settle(t);
		const updated = await t.run((ctx) => ctx.db.get(childProfileId));
		expect(updated?.notificationEmail).toBe('kiddo.new@example.com');
		expect(updated?.notificationEmailVerifiedAt).toBeUndefined();
		expect(verificationEmails().at(-1)?.to).toBe('kiddo.new@example.com');

		// Saving the confirmed address again is a no-op: nothing sent, nothing reset.
		await child.mutation(api.childEmailVerification.confirmChildEmail, { token: latestToken() });
		await settle(t);
		sendEmailMock.mockClear();
		const again = await parent.mutation(api.parentAccounts.setChildNotificationEmail, {
			childProfileId,
			email: 'kiddo.new@example.com'
		});
		expect(again).toEqual({
			notificationEmail: 'kiddo.new@example.com',
			status: 'verified',
			verificationSent: false
		});
		await settle(t);
		expect(sendEmailMock).not.toHaveBeenCalled();
	});

	it('resend issues a new link, invalidates the old one, and is limited to 3 a day', async () => {
		const { t, parent, child, childProfileId, sessionId } = await setup();
		await parent.mutation(api.parentAccounts.setChildNotificationEmail, {
			childProfileId,
			email: 'kiddo@example.com'
		});
		await settle(t);
		const firstToken = latestToken();

		// Resend = the same pending address again. It changes no routing: no new parent notice.
		const resent = await parent.mutation(api.parentAccounts.setChildNotificationEmail, {
			childProfileId,
			email: 'kiddo@example.com'
		});
		expect(resent.verificationSent).toBe(true);
		await settle(t);
		const secondToken = latestToken();
		expect(secondToken).not.toBe(firstToken);
		expect(noticeEmails()).toHaveLength(1);
		expect(
			await child.query(api.childEmailVerification.getChildEmailVerification, { token: firstToken })
		).toEqual({ status: 'notFound' });

		await parent.mutation(api.parentAccounts.setChildNotificationEmail, {
			childProfileId,
			email: 'kiddo@example.com'
		});
		await expect(
			parent.mutation(api.parentAccounts.setChildNotificationEmail, {
				childProfileId,
				email: 'kiddo@example.com'
			})
		).rejects.toThrow(/RESEND_LIMIT_REACHED/);
		await settle(t);
		expect(verificationEmails()).toHaveLength(3);

		// The window is 24 hours (and the parent signed in again since).
		vi.setSystemTime(Date.now() + 24 * 60 * MINUTE + MINUTE);
		await ageSession(t, sessionId, 0);
		await parent.mutation(api.parentAccounts.setChildNotificationEmail, {
			childProfileId,
			email: 'kiddo@example.com'
		});
	});

	it('removing clears the address and its confirmation, invalidates links, and tells the parent', async () => {
		const { t, parent, child, childProfileId } = await setup();
		await parent.mutation(api.parentAccounts.setChildNotificationEmail, {
			childProfileId,
			email: 'kiddo@example.com'
		});
		await settle(t);
		const token = latestToken();

		await parent.mutation(api.parentAccounts.setChildNotificationEmail, {
			childProfileId,
			email: null
		});
		await settle(t);
		const updated = await t.run((ctx) => ctx.db.get(childProfileId));
		expect(updated?.notificationEmail).toBeUndefined();
		expect(updated?.notificationEmailVerifiedAt).toBeUndefined();
		expect(updated?.notificationEmailSource).toBeUndefined();
		expect(
			await child.query(api.childEmailVerification.getChildEmailVerification, { token })
		).toEqual({ status: 'notFound' });
		const notice = noticeEmails().at(-1)!;
		expect(notice.text).toContain("kiddo's notification emails now come to you again.");
		expect(notice.text).not.toMatch(/auth\/link|magic-link/);
	});
});

describe('setChildNotificationEmail: fresh sign-in (review S5)', () => {
	it('works from a session created within 15 minutes and is refused from an older one', async () => {
		const { t, parent, sessionId, childProfileId } = await setup();
		await ageSession(t, sessionId, 14 * MINUTE);
		await parent.mutation(api.parentAccounts.setChildNotificationEmail, {
			childProfileId,
			email: 'kiddo@example.com'
		});

		await ageSession(t, sessionId, 16 * MINUTE);
		for (const email of ['kiddo.other@example.com', 'kiddo@example.com', null]) {
			await expect(
				parent.mutation(api.parentAccounts.setChildNotificationEmail, { childProfileId, email })
			).rejects.toThrow(/FRESH_SESSION_REQUIRED/);
		}
		const child = await t.run((ctx) => ctx.db.get(childProfileId));
		expect(child?.notificationEmail).toBe('kiddo@example.com');
	});

	it('is refused when the identity names no live session of this user', async () => {
		const { t, parentProfileId, childProfileId } = await setup();
		const parentUserId = (await t.run((ctx) => ctx.db.get(parentProfileId)))!.authUserId;
		for (const identity of [
			{ subject: parentUserId },
			{ subject: parentUserId, sessionId: 'not-a-session' }
		]) {
			await expect(
				t.withIdentity(identity).mutation(api.parentAccounts.setChildNotificationEmail, {
					childProfileId,
					email: 'kiddo@example.com'
				})
			).rejects.toThrow(/FRESH_SESSION_REQUIRED/);
		}
	});
});

// Review S5 covers the parent's per-child settings too: a child on the parent's leftover session
// must not be able to switch the parent's copies off (or on).
describe('setParentNotificationSettings: fresh sign-in (review S5)', () => {
	it('works from a session created within 15 minutes and is refused from an older one', async () => {
		const { t, parent, sessionId, childProfileId, parentProfileId } = await setup();
		await ageSession(t, sessionId, 14 * MINUTE);
		await expect(
			parent.mutation(api.parentAccounts.setParentNotificationSettings, {
				childProfileId,
				chatCopies: true
			})
		).resolves.toEqual({ chatCopies: true, activityCopies: false });

		await ageSession(t, sessionId, 16 * MINUTE);
		await expect(
			parent.mutation(api.parentAccounts.setParentNotificationSettings, {
				childProfileId,
				chatCopies: false
			})
		).rejects.toThrow(/FRESH_SESSION_REQUIRED/);
		await expect(
			parent.mutation(api.parentAccounts.setParentNotificationSettings, {
				childProfileId,
				activityCopies: true
			})
		).rejects.toThrow(/FRESH_SESSION_REQUIRED/);
		// A no-op needs no fresh sign-in.
		await expect(
			parent.mutation(api.parentAccounts.setParentNotificationSettings, {
				childProfileId,
				chatCopies: true
			})
		).resolves.toEqual({ chatCopies: true, activityCopies: false });

		const row = await t.run((ctx) =>
			ctx.db
				.query('parentNotificationSettings')
				.withIndex('by_parent_and_child', (q) =>
					q.eq('parentProfileId', parentProfileId).eq('childProfileId', childProfileId)
				)
				.unique()
		);
		expect(row).toMatchObject({ chatCopies: true, activityCopies: false });
	});

	it('is refused when the identity names no live session of this user', async () => {
		const { t, parentProfileId, childProfileId } = await setup();
		const parentUserId = (await t.run((ctx) => ctx.db.get(parentProfileId)))!.authUserId;
		await expect(
			t
				.withIdentity({ subject: parentUserId })
				.mutation(api.parentAccounts.setParentNotificationSettings, {
					childProfileId,
					activityCopies: true
				})
		).rejects.toThrow(/FRESH_SESSION_REQUIRED/);
	});
});

describe('confirmChildEmail / getChildEmailVerification', () => {
	const setPending = async () => {
		const fixture = await setup();
		await fixture.parent.mutation(api.parentAccounts.setChildNotificationEmail, {
			childProfileId: fixture.childProfileId,
			email: 'kiddo@example.com'
		});
		await settle(fixture.t);
		const token = latestToken();
		sendEmailMock.mockClear();
		return { ...fixture, token };
	};

	it('lets the child confirm, and tells the parent the emails now go there', async () => {
		const { t, child, childProfileId, token } = await setPending();
		expect(
			await child.query(api.childEmailVerification.getChildEmailVerification, { token })
		).toEqual({
			status: 'valid',
			username: 'kiddo',
			emailMasked: 'k…@example.com',
			addedBySelf: false
		});

		await child.mutation(api.childEmailVerification.confirmChildEmail, { token });
		await settle(t);
		const updated = await t.run((ctx) => ctx.db.get(childProfileId));
		expect(updated?.notificationEmailVerifiedAt).toEqual(expect.any(Number));
		const [row] = await t.run((ctx) => ctx.db.query('childEmailVerifications').collect());
		expect(row.consumedAt).toEqual(expect.any(Number));
		const notice = noticeEmails().at(-1)!;
		expect(notice.text).toContain("kiddo's notification emails now go to k…@example.com.");
		expect(notice.text).not.toMatch(/auth\/link|magic-link/);

		// Used once.
		expect(
			await child.query(api.childEmailVerification.getChildEmailVerification, { token })
		).toEqual({ status: 'used' });
		await expect(
			child.mutation(api.childEmailVerification.confirmChildEmail, { token })
		).rejects.toThrow(/already used/);
	});

	it('refuses anyone else who is signed in, without consuming the link or naming the child', async () => {
		const { t, parent, sibling, child, childProfileId, token } = await setPending();
		for (const other of [parent, sibling]) {
			expect(
				await other.query(api.childEmailVerification.getChildEmailVerification, { token })
			).toEqual({ status: 'wrongAccount' });
			await expect(
				other.mutation(api.childEmailVerification.confirmChildEmail, { token })
			).rejects.toThrow(/different account/);
		}
		const [row] = await t.run((ctx) => ctx.db.query('childEmailVerifications').collect());
		expect(row.consumedAt).toBeUndefined();
		expect((await t.run((ctx) => ctx.db.get(childProfileId)))?.notificationEmailVerifiedAt).toBe(
			undefined
		);
		// The real child still can.
		await child.mutation(api.childEmailVerification.confirmChildEmail, { token });
	});

	it('refuses an expired link', async () => {
		const { child, token } = await setPending();
		vi.setSystemTime(Date.now() + CHILD_EMAIL_VERIFICATION_TTL_MS + MINUTE);
		expect(
			await child.query(api.childEmailVerification.getChildEmailVerification, { token })
		).toEqual({ status: 'expired', addedBySelf: false });
		await expect(
			child.mutation(api.childEmailVerification.confirmChildEmail, { token })
		).rejects.toThrow(/expired/);
	});

	it('refuses an unknown token', async () => {
		const { child } = await setPending();
		expect(
			await child.query(api.childEmailVerification.getChildEmailVerification, {
				token: 'abcdefghijklmnopqrstuvwxyzABCDEF'
			})
		).toEqual({ status: 'notFound' });
		await expect(
			child.mutation(api.childEmailVerification.confirmChildEmail, { token: '../../etc' })
		).rejects.toThrow(/not valid/);
	});

	it('the daily cleanup deletes expired links', async () => {
		const { t } = await setPending();
		expect(
			await t.mutation(internal.childEmailVerification.deleteExpiredChildEmailVerifications, {})
		).toEqual({ deleted: 0, hasMore: false });
		vi.setSystemTime(Date.now() + CHILD_EMAIL_VERIFICATION_TTL_MS + MINUTE);
		expect(
			await t.mutation(internal.childEmailVerification.deleteExpiredChildEmailVerifications, {})
		).toEqual({ deleted: 1, hasMore: false });
	});
});
