/// <reference types="vite/client" />

import betterAuthTest from '@convex-dev/better-auth/test';
import { hashPassword } from 'better-auth/crypto';
import { convexTest } from 'convex-test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, components } from './_generated/api';
import schema from './schema';
import {
	PARENT_CONSENT_PASSWORD_LIMIT,
	PARENT_CONSENT_SEND_LIMIT_PER_CHILD,
	PARENT_CONSENT_SEND_LIMIT_PER_CONSENT
} from './pendingParentConsent';

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

const PASSWORD = 'kid-password-1';
const HOUR = 60 * 60 * 1000;

const setup = async (options: { status?: 'pending' | 'approved' } = {}) => {
	vi.stubEnv('BETTER_AUTH_URL', 'https://app.example.com');
	const t = convexTest(schema, modules);
	betterAuthTest.register(t);
	const now = Date.now();
	const user = (await t.mutation(components.betterAuth.adapter.create, {
		input: {
			model: 'user',
			data: {
				email: 'kiddo@children.curiosity.local',
				emailVerified: false,
				name: 'kiddo',
				username: 'kiddo',
				createdAt: now,
				updatedAt: now
			}
		}
	})) as { _id: string };
	await t.mutation(components.betterAuth.adapter.create, {
		input: {
			model: 'account',
			data: {
				accountId: user._id,
				providerId: 'credential',
				userId: user._id,
				password: await hashPassword(PASSWORD),
				createdAt: now,
				updatedAt: now
			}
		}
	});
	const consentId = await t.run(async (ctx) => {
		const profileId = await ctx.db.insert('profiles', {
			authUserId: user._id,
			username: 'kiddo',
			isVerified: false,
			firstLoginCompleted: false,
			updatedAt: now
		});
		return ctx.db.insert('parentChildConsents', {
			childProfileId: profileId,
			parentEmail: 'wrong@example.com',
			status: options.status ?? 'pending',
			token: 'old-token',
			createdAt: now - 5 * 24 * HOUR,
			updatedAt: now
		});
	});
	const consent = () => t.run((ctx) => ctx.db.get(consentId));
	const sent = () => sendEmailMock.mock.calls.map(([email]) => email);
	const creds = { username: 'Kiddo ', password: PASSWORD };
	return { t, consent, sent, creds };
};

afterEach(() => {
	sendEmailMock.mockClear();
	vi.unstubAllEnvs();
	vi.useRealTimers();
});

describe('pending parent consent: change or resend the parent email (CL-772)', () => {
	it('shows where the email went, only with the right password', async () => {
		const { t, creds } = await setup();
		expect(await t.action(api.pendingParentConsent.getPendingParentConsent, creds)).toEqual({
			status: 'pending',
			parentEmail: 'wrong@example.com'
		});
		const wrong = await t.action(api.pendingParentConsent.getPendingParentConsent, {
			username: 'kiddo',
			password: 'nope-nope'
		});
		const unknown = await t.action(api.pendingParentConsent.getPendingParentConsent, {
			username: 'nobody_here',
			password: PASSWORD
		});
		// An unknown username and a wrong password look the same.
		expect(wrong).toEqual({ status: 'invalid_credentials' });
		expect(unknown).toEqual(wrong);
	});

	it('changing the address sends a new link there and the old link stops working', async () => {
		const { t, consent, sent, creds } = await setup();
		const before = await consent();
		const result = await t.action(api.pendingParentConsent.changeParentConsentEmail, {
			...creds,
			parentEmail: ' Right@Example.com '
		});
		expect(result).toEqual({ status: 'sent', parentEmail: 'right@example.com' });

		const after = await consent();
		expect(after?.parentEmail).toBe('right@example.com');
		expect(after?.token).not.toBe('old-token');
		expect(after?.createdAt).toBe(before?.createdAt); // the 90-day clock keeps running
		expect(await t.query(api.childSignup.getConsentByToken, { token: 'old-token' })).toBeNull();
		expect(
			(await t.query(api.childSignup.getConsentByToken, { token: after!.token }))?.parentEmail
		).toBe('right@example.com');

		expect(sent()).toHaveLength(1);
		expect(sent()[0].to).toBe('right@example.com');
		expect(sent()[0].text).toContain(`https://app.example.com/onboarding/parent-consent/${after!.token}`);
	});

	it('resend keeps the address and the link', async () => {
		const { t, consent, sent, creds } = await setup();
		expect(await t.action(api.pendingParentConsent.resendParentConsentEmail, creds)).toEqual({
			status: 'sent',
			parentEmail: 'wrong@example.com'
		});
		expect((await consent())?.token).toBe('old-token');
		expect(sent()[0].text).toContain('/onboarding/parent-consent/old-token');
	});

	it('rejects an invalid address without sending or counting', async () => {
		const { t, consent, sent, creds } = await setup();
		expect(
			await t.action(api.pendingParentConsent.changeParentConsentEmail, {
				...creds,
				parentEmail: 'not-an-email'
			})
		).toEqual({ status: 'invalid_email' });
		expect((await consent())?.parentEmail).toBe('wrong@example.com');
		expect(sent()).toHaveLength(0);
	});

	it('does nothing once the parent has approved', async () => {
		const { t, sent, creds } = await setup({ status: 'approved' });
		expect(await t.action(api.pendingParentConsent.resendParentConsentEmail, creds)).toEqual({
			status: 'not_pending'
		});
		expect(
			await t.action(api.pendingParentConsent.changeParentConsentEmail, {
				...creds,
				parentEmail: 'x@example.com'
			})
		).toEqual({ status: 'not_pending' });
		expect(sent()).toHaveLength(0);
	});

	it('caps sends per consent per hour, then per child per day, and says no email was sent', async () => {
		vi.useFakeTimers();
		const { t, consent, sent, creds } = await setup();
		for (let i = 0; i < PARENT_CONSENT_SEND_LIMIT_PER_CONSENT.maxAttempts; i += 1) {
			expect((await t.action(api.pendingParentConsent.resendParentConsentEmail, creds)).status).toBe(
				'sent'
			);
		}
		expect(await t.action(api.pendingParentConsent.resendParentConsentEmail, creds)).toEqual({
			status: 'rate_limited',
			parentEmail: 'wrong@example.com',
			retryAfter: 'hour'
		});
		// A change is a send too: blocked, and the address and link stay as they were.
		expect(
			await t.action(api.pendingParentConsent.changeParentConsentEmail, {
				...creds,
				parentEmail: 'other@example.com'
			})
		).toMatchObject({ status: 'rate_limited' });
		expect(await consent()).toMatchObject({ parentEmail: 'wrong@example.com', token: 'old-token' });
		expect(sent()).toHaveLength(PARENT_CONSENT_SEND_LIMIT_PER_CONSENT.maxAttempts);

		// After an hour the per-consent window resets, until the daily per-child cap.
		vi.advanceTimersByTime(HOUR + 1);
		const remaining =
			PARENT_CONSENT_SEND_LIMIT_PER_CHILD.maxAttempts - PARENT_CONSENT_SEND_LIMIT_PER_CONSENT.maxAttempts;
		for (let i = 0; i < remaining; i += 1) {
			expect((await t.action(api.pendingParentConsent.resendParentConsentEmail, creds)).status).toBe(
				'sent'
			);
		}
		vi.advanceTimersByTime(HOUR + 1);
		expect(await t.action(api.pendingParentConsent.resendParentConsentEmail, creds)).toMatchObject({
			status: 'rate_limited',
			retryAfter: 'day'
		});
		expect(sent()).toHaveLength(PARENT_CONSENT_SEND_LIMIT_PER_CHILD.maxAttempts);
	});

	it('locks out password guessing for the username', async () => {
		const { t, sent, creds } = await setup();
		for (let i = 0; i < PARENT_CONSENT_PASSWORD_LIMIT.maxAttempts; i += 1) {
			await t.action(api.pendingParentConsent.resendParentConsentEmail, {
				username: 'kiddo',
				password: `guess-${i}`
			});
		}
		expect(await t.action(api.pendingParentConsent.resendParentConsentEmail, creds)).toEqual({
			status: 'too_many_attempts'
		});
		expect(sent()).toHaveLength(0);
	});
});
