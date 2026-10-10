/// <reference types="vite/client" />

// magicLinks.mintMagicLink writes Better Auth magic-link verification rows directly instead of
// going through the plugin's endpoint. These specs mount the real betterAuth component and pin
// the row to the exact shape the plugin's verify endpoint reads (better-auth 1.4.9,
// plugins/magic-link/index.mjs + utils.mjs, with storeToken: 'hashed'). If a Better Auth upgrade
// changes that contract, these must fail before parents' sign-in links do.

import betterAuthTest from '@convex-dev/better-auth/test';
import { createHash } from '@better-auth/utils/hash';
import { base64Url } from '@better-auth/utils/base64';
import { convexTest } from 'convex-test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { components } from './_generated/api';
import { hashMagicLinkToken, mintMagicLink } from './magicLinks';
import schema from './schema';
import {
	MAGIC_LINK_EXPIRES_IN_SECONDS,
	buildMagicLinkErrorPath,
	toMagicLinkCallbackParam
} from '../lib/auth/magic-link';

const modules = import.meta.glob('./**/*.ts');

const { sendEmailMock } = vi.hoisted(() => ({
	sendEmailMock: vi.fn<
		(email: { to: string; type: string; text: string }) => Promise<{ providerMessageId: string }>
	>(async () => ({ providerMessageId: 'resend-msg-1' }))
}));

vi.mock('./email/resend', () => ({
	sendEmail: sendEmailMock
}));

// better-auth's own defaultKeyHasher (magic-link/utils.mjs), rebuilt from the same primitives.
const pluginKeyHasher = async (token: string) =>
	base64Url.encode(
		new Uint8Array(await createHash('SHA-256').digest(new TextEncoder().encode(token))),
		{ padding: false }
	);

type VerificationRow = {
	identifier: string;
	value: string;
	expiresAt: number;
	createdAt: number;
	updatedAt: number;
};

const setup = async (options: { withUser?: boolean } = {}) => {
	const t = convexTest(schema, modules);
	betterAuthTest.register(t);
	if (options.withUser ?? true) {
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
	}
	return t;
};

const findVerification = (t: Awaited<ReturnType<typeof setup>>, identifier: string) =>
	t.query(components.betterAuth.adapter.findOne, {
		model: 'verification',
		where: [{ field: 'identifier', value: identifier }]
	}) as Promise<VerificationRow | null>;

afterEach(() => {
	vi.unstubAllEnvs();
	sendEmailMock.mockClear();
});

const stubAuthEnv = () => {
	vi.stubEnv('BETTER_AUTH_URL', 'https://app.example.com');
	vi.stubEnv('CONVEX_SITE_URL', 'https://site.example.com');
	vi.stubEnv('BETTER_AUTH_SECRET', 'test-secret-'.repeat(4));
};

describe('mintMagicLink', () => {
	it('builds a verify URL under the auth base path with the callbacks the plugin expects', async () => {
		vi.stubEnv('BETTER_AUTH_URL', 'https://app.example.com');
		const t = await setup();

		const link = await t.run((ctx) =>
			mintMagicLink(ctx, {
				email: 'Parent@Example.com',
				callbackURL: '/child/abc?room=xyz',
				errorCallbackURL: '/auth/sign-in?next=%2Fchild%2Fabc%3Froom%3Dxyz&link=expired'
			})
		);

		const url = new URL(link!);
		expect(`${url.origin}${url.pathname}`).toBe(
			'https://app.example.com/api/auth/magic-link/verify'
		);
		expect(url.searchParams.get('token')).toMatch(/^[a-zA-Z]{32}$/);
		// The verify endpoint decodeURIComponent()s these once more before validating and
		// redirecting; that extra decode must yield exactly the intended paths.
		expect(decodeURIComponent(url.searchParams.get('callbackURL')!)).toBe('/child/abc?room=xyz');
		expect(decodeURIComponent(url.searchParams.get('errorCallbackURL')!)).toBe(
			'/auth/sign-in?next=%2Fchild%2Fabc%3Froom%3Dxyz&link=expired'
		);
	});

	it('stores the row the magic-link plugin reads: hashed identifier, email JSON, 7-day expiry', async () => {
		vi.stubEnv('BETTER_AUTH_URL', 'https://app.example.com');
		const t = await setup();
		const before = Date.now();

		const link = await t.run((ctx) =>
			mintMagicLink(ctx, { email: 'parent@example.com', callbackURL: '/child/abc' })
		);
		const token = new URL(link!).searchParams.get('token')!;

		// storeToken: 'hashed' → the plugin looks the row up by its own hash of the token.
		const identifier = await pluginKeyHasher(token);
		expect(await hashMagicLinkToken(token)).toBe(identifier);
		const row = await findVerification(t, identifier);
		expect(row).not.toBeNull();
		// Never the raw token at rest.
		expect(await findVerification(t, token)).toBeNull();
		// verify: JSON.parse(value) → { email, name } → findUserByEmail(email).
		expect(JSON.parse(row!.value)).toEqual({ email: 'parent@example.com' });
		expect(row!.expiresAt).toBeGreaterThanOrEqual(before + MAGIC_LINK_EXPIRES_IN_SECONDS * 1000);
		expect(row!.expiresAt).toBeLessThanOrEqual(Date.now() + MAGIC_LINK_EXPIRES_IN_SECONDS * 1000);
		expect(MAGIC_LINK_EXPIRES_IN_SECONDS).toBe(7 * 24 * 60 * 60);
		expect(typeof row!.createdAt).toBe('number');
		expect(typeof row!.updatedAt).toBe('number');
	});

	it('mints a different single-use token on every call', async () => {
		vi.stubEnv('BETTER_AUTH_URL', 'https://app.example.com');
		const t = await setup();

		const [first, second] = await t.run(async (ctx) => [
			await mintMagicLink(ctx, { email: 'parent@example.com', callbackURL: '/child/abc' }),
			await mintMagicLink(ctx, { email: 'parent@example.com', callbackURL: '/child/abc' })
		]);

		expect(new URL(first!).searchParams.get('token')).not.toBe(
			new URL(second!).searchParams.get('token')
		);
	});

	// The real thing: the minted link through the app's registered Better Auth routes (http.ts),
	// i.e. the plugin's own verify endpoint reading our row.
	it('signs the user in through the real verify endpoint, once', async () => {
		stubAuthEnv();
		const t = await setup();
		const link = await t.run((ctx) =>
			mintMagicLink(ctx, {
				email: 'parent@example.com',
				callbackURL: '/child/abc?room=xyz',
				errorCallbackURL: '/auth/sign-in?next=%2Fchild%2Fabc%3Froom%3Dxyz&link=expired'
			})
		);
		const { pathname, search } = new URL(link!);

		const first = await t.fetch(`${pathname}${search}`, { method: 'GET' });
		expect(first.status).toBe(302);
		expect(first.headers.get('location')).toBe('https://app.example.com/child/abc?room=xyz');
		expect(first.headers.get('set-cookie')).toContain('better-auth.session_token=');
		expect(first.headers.get('set-cookie')).toContain('convex_jwt=');

		// Single use: the second click lands on the sign-in page's expired-link fallback, with
		// `next` still pointing at the original page.
		const second = await t.fetch(`${pathname}${search}`, { method: 'GET' });
		expect(second.status).toBe(302);
		const fallback = new URL(second.headers.get('location')!);
		expect(fallback.pathname).toBe('/auth/sign-in');
		expect(fallback.searchParams.get('next')).toBe('/child/abc?room=xyz');
		expect(fallback.searchParams.get('link')).toBe('expired');
		expect(fallback.searchParams.get('error')).toBe('INVALID_TOKEN');
	});

	it('an expired link redirects to the fallback with EXPIRED_TOKEN', async () => {
		stubAuthEnv();
		const t = await setup();
		const link = await t.run((ctx) =>
			mintMagicLink(ctx, {
				email: 'parent@example.com',
				callbackURL: '/child/abc',
				errorCallbackURL: '/auth/sign-in?next=%2Fchild%2Fabc&link=expired'
			})
		);
		const { pathname, search, searchParams } = new URL(link!);
		await t.mutation(components.betterAuth.adapter.updateOne, {
			input: {
				model: 'verification',
				where: [
					{ field: 'identifier', value: await hashMagicLinkToken(searchParams.get('token')!) }
				],
				update: { expiresAt: Date.now() - 1000 }
			}
		});

		const response = await t.fetch(`${pathname}${search}`, { method: 'GET' });
		expect(response.status).toBe(302);
		const fallback = new URL(response.headers.get('location')!);
		expect(fallback.pathname).toBe('/auth/sign-in');
		expect(fallback.searchParams.get('error')).toBe('EXPIRED_TOKEN');
		expect(response.headers.get('set-cookie') ?? '').not.toContain('better-auth.session_token=');
	});

	it('mints nothing for an address without an account (the plugin runs with disableSignUp)', async () => {
		vi.stubEnv('BETTER_AUTH_URL', 'https://app.example.com');
		const t = await setup({ withUser: false });

		const link = await t.run((ctx) =>
			mintMagicLink(ctx, { email: 'parent@example.com', callbackURL: '/child/abc' })
		);

		expect(link).toBeNull();
	});

	it('mints nothing without BETTER_AUTH_URL (no absolute link to build)', async () => {
		vi.stubEnv('BETTER_AUTH_URL', '');
		const t = await setup();

		const link = await t.run((ctx) =>
			mintMagicLink(ctx, { email: 'parent@example.com', callbackURL: '/child/abc' })
		);

		expect(link).toBeNull();
	});
});

// The sign-in page's "Send me a new link" goes through the plugin's own endpoint with the same
// callback encoding (lib/auth/magic-link.ts) — the emailed link must survive the verify
// endpoint's origin check and land on the right pages.
describe('POST /sign-in/magic-link (expired-link fallback)', () => {
	const requestLink = (t: Awaited<ReturnType<typeof setup>>, email: string) =>
		t.fetch('/api/auth/sign-in/magic-link', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				email,
				callbackURL: toMagicLinkCallbackParam('/child/abc?room=xyz'),
				errorCallbackURL: toMagicLinkCallbackParam(buildMagicLinkErrorPath('/child/abc?room=xyz'))
			})
		});

	it('emails an existing user a link that signs them in and continues to the page', async () => {
		stubAuthEnv();
		const t = await setup();

		const response = await requestLink(t, 'parent@example.com');
		expect(response.status).toBe(200);
		expect(sendEmailMock).toHaveBeenCalledTimes(1);
		const email = sendEmailMock.mock.calls[0][0];
		expect(email).toMatchObject({ to: 'parent@example.com', type: 'magic-link' });
		const link = new URL(email.text.match(/https:\/\/\S+/)![0]);
		expect(link.pathname).toBe('/api/auth/magic-link/verify');

		const verify = await t.fetch(`${link.pathname}${link.search}`, { method: 'GET' });
		expect(verify.status).toBe(302);
		expect(verify.headers.get('location')).toBe('https://app.example.com/child/abc?room=xyz');

		const reused = await t.fetch(`${link.pathname}${link.search}`, { method: 'GET' });
		const fallback = new URL(reused.headers.get('location')!);
		expect(fallback.pathname).toBe('/auth/sign-in');
		expect(fallback.searchParams.get('next')).toBe('/child/abc?room=xyz');
		expect(fallback.searchParams.get('link')).toBe('expired');
	});

	it('answers the same but sends nothing for an unknown address', async () => {
		stubAuthEnv();
		const t = await setup({ withUser: false });

		const response = await requestLink(t, 'stranger@example.com');
		expect(response.status).toBe(200);
		expect(sendEmailMock).not.toHaveBeenCalled();
	});
});
