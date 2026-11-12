/// <reference types="vite/client" />

// CL-775: what someone who is not signed in can learn about accounts from the sign-in and
// sign-up lookups. Mounts the real betterAuth component and goes through Better Auth's HTTP
// endpoints, so the hooks in auth.ts run exactly as they do for the sign-in pages.

import betterAuthTest from '@convex-dev/better-auth/test';
import { hashPassword } from 'better-auth/crypto';
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, components } from './_generated/api';
import * as authModule from './auth';
import { PARENT_CONSENT_PENDING_CODE, SIGNUP_EMAIL_LOOKUP_RATE_LIMIT } from './auth';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

const { sendEmailMock } = vi.hoisted(() => ({
	sendEmailMock: vi.fn<
		(email: { to: string; type: string }) => Promise<{ providerMessageId: string }>
	>(async () => ({ providerMessageId: 'resend-msg-1' }))
}));

vi.mock('./email/resend', () => ({
	sendEmail: sendEmailMock
}));

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

type TestConvex = ReturnType<typeof convexTest>;

const PASSWORD = 'a-long-password-1';

const createUser = async (
	t: TestConvex,
	data: { email: string; username?: string; emailVerified: boolean },
	providers: Array<'credential' | 'google'> = []
) => {
	const now = Date.now();
	const user = (await t.mutation(components.betterAuth.adapter.create, {
		input: {
			model: 'user',
			data: { ...data, name: data.username ?? data.email, createdAt: now, updatedAt: now }
		}
	})) as { _id: string };
	for (const providerId of providers) {
		await t.mutation(components.betterAuth.adapter.create, {
			input: {
				model: 'account',
				data: {
					accountId: providerId === 'google' ? `google-${user._id}` : user._id,
					providerId,
					userId: user._id,
					...(providerId === 'credential' ? { password: await hashPassword(PASSWORD) } : {}),
					createdAt: now,
					updatedAt: now
				}
			}
		});
	}
	return user._id;
};

// The accounts the sign-in pages deal with.
const setup = async () => {
	const t = convexTest(schema, modules);
	betterAuthTest.register(t);
	await createUser(t, { email: 'adult@example.com', username: 'adult_user', emailVerified: true }, [
		'credential'
	]);
	await createUser(
		t,
		{ email: 'unverified@example.com', username: 'unverified_user', emailVerified: false },
		['credential']
	);
	// Created at consent approval: verified, no password, no Google.
	await createUser(t, { email: 'parent@example.com', emailVerified: true });
	await createUser(t, { email: 'googler@example.com', emailVerified: true }, ['google']);
	// A child is unverified until the parent approves (childSignup.approveConsent).
	await createUser(
		t,
		{
			email: 'pending_kid@children.curiosity.local',
			username: 'pending_kid',
			emailVerified: false
		},
		['credential']
	);
	await createUser(
		t,
		{
			email: 'approved_kid@children.curiosity.local',
			username: 'approved_kid',
			emailVerified: true
		},
		['credential']
	);
	return t;
};

const post = (t: TestConvex, path: string, body: Record<string, unknown>) =>
	t.fetch(`/api/auth${path}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});

const NO_ACCOUNT = {
	exists: false,
	isVerified: false,
	firstLoginCompleted: false,
	hasGoogle: false,
	googleOnly: false
};

describe('removed public lookups', () => {
	it('no longer exports the username-to-email and username-status queries', () => {
		expect(authModule).not.toHaveProperty('getAuthUserByUsername');
		expect(authModule).not.toHaveProperty('resolveAuthIdentifier');
		expect(authModule).not.toHaveProperty('getUsernameLoginStatus');
		expect(authModule).not.toHaveProperty('getSignupAccountStatusByEmail');
	});
});

describe('auth.checkSignupEmail', () => {
	it('answers "no account" for an unknown address', async () => {
		const t = await setup();
		expect(await t.mutation(api.auth.checkSignupEmail, { email: 'nobody@example.com' })).toEqual(
			NO_ACCOUNT
		);
	});

	it('says an address has an account, but not whether it has a password', async () => {
		const t = await setup();
		const withPassword = await t.mutation(api.auth.checkSignupEmail, {
			email: 'Adult@Example.com'
		});
		const passwordless = await t.mutation(api.auth.checkSignupEmail, {
			email: 'parent@example.com'
		});
		expect(withPassword).toEqual({
			exists: true,
			isVerified: true,
			firstLoginCompleted: false,
			hasGoogle: false,
			googleOnly: false
		});
		// A password-less (consent-created parent) account looks like any password account.
		expect(passwordless).toEqual(withPassword);
		// Never an address, username or id.
		expect(Object.keys(withPassword).sort()).toEqual(
			['exists', 'firstLoginCompleted', 'googleOnly', 'hasGoogle', 'isVerified'].sort()
		);
	});

	it('tells sign-up to continue with Google for a Google-only account', async () => {
		const t = await setup();
		expect(
			await t.mutation(api.auth.checkSignupEmail, { email: 'googler@example.com' })
		).toMatchObject({ exists: true, hasGoogle: true, googleOnly: true });
	});

	it('never reports a child account, even by its internal address', async () => {
		const t = await setup();
		expect(
			await t.mutation(api.auth.checkSignupEmail, {
				email: 'approved_kid@children.curiosity.local'
			})
		).toEqual(NO_ACCOUNT);
		expect(await t.mutation(api.auth.checkSignupEmail, { email: 'approved_kid' })).toEqual(
			NO_ACCOUNT
		);
	});

	it('answers "no account" for everyone once the shared cap is reached, until the window ends', async () => {
		vi.useFakeTimers();
		const t = await setup();
		for (let i = 0; i < SIGNUP_EMAIL_LOOKUP_RATE_LIMIT.maxAttempts; i += 1) {
			expect(
				(await t.mutation(api.auth.checkSignupEmail, { email: `probe${i}@example.com` })).exists
			).toBe(false);
		}
		expect(await t.mutation(api.auth.checkSignupEmail, { email: 'adult@example.com' })).toEqual(
			NO_ACCOUNT
		);

		vi.advanceTimersByTime(SIGNUP_EMAIL_LOOKUP_RATE_LIMIT.windowMs);
		expect(
			(await t.mutation(api.auth.checkSignupEmail, { email: 'adult@example.com' })).exists
		).toBe(true);
	});
});

describe('Forgot password with a username (POST /request-password-reset)', () => {
	const requestReset = async (t: TestConvex, identifier: string) => {
		const response = await post(t, '/request-password-reset', {
			email: identifier,
			redirectTo: '/auth/reset-password'
		});
		return { status: response.status, body: await response.json() };
	};

	it('emails the account behind the username, and answers the same for an unknown one', async () => {
		const t = await setup();

		const known = await requestReset(t, 'Adult_User');
		expect(sendEmailMock).toHaveBeenCalledTimes(1);
		expect(sendEmailMock.mock.calls[0][0]).toMatchObject({
			to: 'adult@example.com',
			type: 'password-reset'
		});
		sendEmailMock.mockClear();

		const unknown = await requestReset(t, 'no_such_user');
		const malformed = await requestReset(t, 'not a username!');
		const byUnknownEmail = await requestReset(t, 'nobody@example.com');
		expect(sendEmailMock).not.toHaveBeenCalled();

		expect(known).toEqual({ status: 200, body: expect.objectContaining({ status: true }) });
		expect(unknown).toEqual(known);
		expect(malformed).toEqual(known);
		expect(byUnknownEmail).toEqual(known);
		// The address is never in the answer.
		expect(JSON.stringify(known.body)).not.toContain('adult@example.com');
	});

	it('answers the same and sends nothing for a child username', async () => {
		const t = await setup();
		const child = await requestReset(t, 'approved_kid');
		expect(sendEmailMock).not.toHaveBeenCalled();
		expect(child).toEqual(await requestReset(t, 'no_such_user'));
	});
});

describe('Resend verification with a username (POST /send-verification-email)', () => {
	it('emails the unverified account behind the username, and answers the same for an unknown one', async () => {
		const t = await setup();

		const known = await post(t, '/send-verification-email', { email: 'unverified_user' });
		expect(sendEmailMock).toHaveBeenCalledTimes(1);
		expect(sendEmailMock.mock.calls[0][0]).toMatchObject({ to: 'unverified@example.com' });
		sendEmailMock.mockClear();

		const unknown = await post(t, '/send-verification-email', { email: 'no_such_user' });
		expect(sendEmailMock).not.toHaveBeenCalled();
		expect(known.status).toBe(200);
		expect(unknown.status).toBe(200);
		expect(await unknown.json()).toEqual(await known.json());
	});
});

describe('Username sign-in (POST /sign-in/username)', () => {
	const signIn = async (t: TestConvex, username: string, password: string) => {
		const response = await post(t, '/sign-in/username', { username, password });
		return { status: response.status, body: (await response.json()) as { code?: string } };
	};

	it('tells a child with the right password that a parent has to approve first', async () => {
		const t = await setup();
		const result = await signIn(t, 'pending_kid', PASSWORD);
		expect(result.status).toBe(403);
		expect(result.body.code).toBe(PARENT_CONSENT_PENDING_CODE);
	});

	it('tells someone without the password nothing about a pending child', async () => {
		const t = await setup();
		const wrongPassword = await signIn(t, 'pending_kid', 'not-the-password');
		const unknown = await signIn(t, 'no_such_user', 'not-the-password');
		expect(wrongPassword).toEqual(unknown);
		expect(wrongPassword.status).toBe(401);
	});

	it('signs in an approved child and keeps "not verified" for an unverified adult', async () => {
		const t = await setup();
		expect((await signIn(t, 'approved_kid', PASSWORD)).status).toBe(200);
		const adult = await signIn(t, 'unverified_user', PASSWORD);
		expect(adult.status).toBe(403);
		expect(adult.body.code).not.toBe(PARENT_CONSENT_PENDING_CODE);
	});
});
