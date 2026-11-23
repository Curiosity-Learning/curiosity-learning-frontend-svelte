/// <reference types="vite/client" />

// magicLinks.mintMagicLink writes Better Auth magic-link verification rows directly instead of
// going through the plugin's endpoint. These specs mount the real betterAuth component and pin
// the row to the exact shape the plugin's verify endpoint reads (better-auth 1.7.27,
// plugins/magic-link/index.mjs + utils.mjs, with storeToken: 'hashed'). If a Better Auth upgrade
// changes that contract, these must fail before parents' sign-in links do.

import betterAuthTest from '@convex-dev/better-auth/test';
import { createHash } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import { convexTest } from 'convex-test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { components } from './_generated/api';
import { hashMagicLinkToken, mintMagicLink, toMigratedMagicLinkRow } from './magicLinks';
import { internal } from './_generated/api';
import schema from './schema';
import {
	EMAIL_MAGIC_LINK_SECONDS,
	SELF_SERVICE_MAGIC_LINK_SECONDS,
	buildMagicLinkErrorPath,
	buildMagicLinkVerifyPath,
	parseMagicLinkInterstitialFragment,
	toMagicLinkCallbackParam
} from '../lib/auth/magic-link';
import { parseSetCookie, resolveConvexToken } from '../lib/server/convex-token';

const modules = import.meta.glob('./**/*.ts');

const { sendEmailMock } = vi.hoisted(() => ({
	sendEmailMock: vi.fn<
		(email: { to: string; type: string; text: string }) => Promise<{ providerMessageId: string }>
	>(async () => ({ providerMessageId: 'resend-msg-1' }))
}));

vi.mock('./email/resend', () => ({
	sendEmail: sendEmailMock
}));

// better-auth's own defaultKeyHasher (magic-link/utils.mjs: base64url(SHA-256), no padding),
// rebuilt independently with node:crypto.
const pluginKeyHasher = async (token: string) =>
	createHash('sha256').update(token).digest('base64url');

// The 1.7 plugin's verification identifier for a token (magicLinkIdentifier in index.mjs).
const pluginIdentifier = async (token: string) => `magic-link:${await pluginKeyHasher(token)}`;

type VerificationRow = {
	identifier: string;
	value: string;
	expiresAt: number;
	createdAt: number;
	updatedAt: number;
};

const setup = async (
	options: { withUser?: boolean; emailVerified?: boolean; platformAdmin?: boolean } = {}
) => {
	const t = convexTest(schema, modules);
	betterAuthTest.register(t);
	if (options.withUser ?? true) {
		const now = Date.now();
		const user = (await t.mutation(components.betterAuth.adapter.create, {
			input: {
				model: 'user',
				data: {
					email: 'parent@example.com',
					emailVerified: options.emailVerified ?? true,
					name: 'parent',
					createdAt: now,
					updatedAt: now
				}
			}
		})) as { _id: string };
		if (options.platformAdmin) {
			await t.run((ctx) =>
				ctx.db.insert('profiles', {
					authUserId: user._id,
					globalRole: 'admin',
					isVerified: true,
					firstLoginCompleted: true,
					updatedAt: now
				})
			);
		}
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

// What the /auth/link interstitial does in the browser: read the fragment, build the verify URL.
const interstitialToVerifyPath = (link: string) => {
	const url = new URL(link);
	const parsed = parseMagicLinkInterstitialFragment(url.hash);
	if (!parsed) throw new Error(`Not an interstitial link: ${link}`);
	return buildMagicLinkVerifyPath(parsed);
};

const mint = (
	t: Awaited<ReturnType<typeof setup>>,
	callbackPath = '/child/abc?room=xyz',
	expiresInSeconds = EMAIL_MAGIC_LINK_SECONDS
) =>
	t.run((ctx) =>
		mintMagicLink(ctx, { email: 'Parent@Example.com', callbackPath, expiresInSeconds })
	);

describe('mintMagicLink', () => {
	// Review S1: never the verify endpoint itself (mail scanners would consume the token), and
	// the token only in the fragment (never sent to a server).
	it('hands out the /auth/link interstitial with token, next and the address in the fragment', async () => {
		vi.stubEnv('BETTER_AUTH_URL', 'https://app.example.com');
		const t = await setup();

		const link = await mint(t);

		const url = new URL(link!);
		expect(`${url.origin}${url.pathname}`).toBe('https://app.example.com/auth/link');
		expect(url.search).toBe('');
		const parsed = parseMagicLinkInterstitialFragment(url.hash);
		expect(parsed?.token).toMatch(/^[a-zA-Z]{32}$/);
		expect(parsed?.next).toBe('/child/abc?room=xyz');
		expect(parsed?.as).toBe('parent@example.com');
		// What the interstitial's button opens: the verify endpoint with exactly the intended
		// callback paths (Better Auth 1.7 decodes them once, like any query param).
		const verify = new URL(interstitialToVerifyPath(link!), 'https://app.example.com');
		expect(verify.pathname).toBe('/api/auth/magic-link/verify');
		// The landing page is marked as reached through a sign-in link (CL-769 banner).
		expect(verify.searchParams.get('callbackURL')).toBe('/child/abc?room=xyz&via=link');
		expect(verify.searchParams.get('errorCallbackURL')).toBe(
			'/auth/sign-in?next=%2Fchild%2Fabc%3Froom%3Dxyz&link=expired'
		);
	});

	it('stores the row the magic-link plugin reads: prefixed hashed identifier, typed email JSON, the given lifetime', async () => {
		vi.stubEnv('BETTER_AUTH_URL', 'https://app.example.com');
		const t = await setup();
		const before = Date.now();

		const link = await mint(t, '/child/abc', 30 * 60);
		const token = parseMagicLinkInterstitialFragment(new URL(link!).hash)!.token;

		// storeToken: 'hashed' → the plugin looks the row up by `magic-link:` + its own hash.
		expect(await hashMagicLinkToken(token)).toBe(await pluginKeyHasher(token));
		const identifier = await pluginIdentifier(token);
		const row = await findVerification(t, identifier);
		expect(row).not.toBeNull();
		// Never the raw token at rest, and never the pre-1.7 unprefixed identifier.
		expect(await findVerification(t, token)).toBeNull();
		expect(await findVerification(t, await pluginKeyHasher(token))).toBeNull();
		// verify: strict { type: 'magic-link', email, name? } → findUserByEmail(email).
		expect(JSON.parse(row!.value)).toEqual({ type: 'magic-link', email: 'parent@example.com' });
		expect(row!.expiresAt).toBeGreaterThanOrEqual(before + 30 * 60 * 1000);
		expect(row!.expiresAt).toBeLessThanOrEqual(Date.now() + 30 * 60 * 1000);
		expect(typeof row!.createdAt).toBe('number');
		expect(typeof row!.updatedAt).toBe('number');
	});

	it('pins the per-use lifetimes (review S3)', () => {
		expect(EMAIL_MAGIC_LINK_SECONDS).toBe(48 * 60 * 60);
		expect(SELF_SERVICE_MAGIC_LINK_SECONDS).toBe(30 * 60);
	});

	it('mints a different single-use token on every call', async () => {
		vi.stubEnv('BETTER_AUTH_URL', 'https://app.example.com');
		const t = await setup();

		const first = await mint(t);
		const second = await mint(t);

		expect(new URL(first!).hash).not.toBe(new URL(second!).hash);
	});

	// The real thing: the minted link through the app's registered Better Auth routes (http.ts),
	// i.e. the plugin's own verify endpoint reading our row.
	it('signs the user in through the real verify endpoint, once', async () => {
		stubAuthEnv();
		const t = await setup();
		const verifyPath = interstitialToVerifyPath((await mint(t))!);

		const first = await t.fetch(verifyPath, { method: 'GET' });
		expect(first.status).toBe(302);
		expect(first.headers.get('location')).toBe(
			'https://app.example.com/child/abc?room=xyz&via=link'
		);
		expect(first.headers.get('set-cookie')).toContain('better-auth.session_token=');
		expect(first.headers.get('set-cookie')).toContain('convex_jwt=');

		// Single use: the second click lands on the sign-in page's expired-link fallback, with
		// `next` still pointing at the original page.
		const second = await t.fetch(verifyPath, { method: 'GET' });
		expect(second.status).toBe(302);
		const fallback = new URL(second.headers.get('location')!);
		expect(fallback.pathname).toBe('/auth/sign-in');
		expect(fallback.searchParams.get('next')).toBe('/child/abc?room=xyz');
		expect(fallback.searchParams.get('link')).toBe('expired');
		expect(fallback.searchParams.get('error')).toBe('INVALID_TOKEN');
	});

	// Review S10: the error redirect's `next` carries an encoded query, which only survives if
	// toMagicLinkCallbackParam matches how the verify endpoint decodes callback params (1.4
	// decoded them twice, 1.7 once). A mismatch leaves a literal %2F / %25 in `next` and silently
	// sends the user to "/" — this pins it.
	// Better Auth 1.7 no longer tells an expired token apart from an unknown one (both
	// INVALID_TOKEN); the sign-in page keys on our `link=expired` marker either way.
	it('an expired link redirects to the sign-in fallback with `next` intact, query included', async () => {
		stubAuthEnv();
		const t = await setup();
		const link = (await mint(t, '/child/abc?room=xyz'))!;
		const verifyPath = interstitialToVerifyPath(link);
		const token = parseMagicLinkInterstitialFragment(new URL(link).hash)!.token;
		await t.mutation(components.betterAuth.adapter.updateOne, {
			input: {
				model: 'verification',
				where: [{ field: 'identifier', value: await pluginIdentifier(token) }],
				update: { expiresAt: Date.now() - 1000 }
			}
		});

		const response = await t.fetch(verifyPath, { method: 'GET' });
		expect(response.status).toBe(302);
		const fallback = new URL(response.headers.get('location')!);
		expect(fallback.pathname).toBe('/auth/sign-in');
		expect(fallback.searchParams.get('error')).toBe('INVALID_TOKEN');
		expect(fallback.searchParams.get('link')).toBe('expired');
		expect(fallback.searchParams.get('next')).toBe('/child/abc?room=xyz');
		expect(response.headers.get('set-cookie') ?? '').not.toContain('better-auth.session_token=');
	});

	it('mints nothing for an address without an account (the plugin runs with disableSignUp)', async () => {
		vi.stubEnv('BETTER_AUTH_URL', 'https://app.example.com');
		const t = await setup({ withUser: false });

		const link = await t.run((ctx) =>
			mintMagicLink(ctx, {
				email: 'parent@example.com',
				callbackPath: '/child/abc',
				expiresInSeconds: EMAIL_MAGIC_LINK_SECONDS
			})
		);

		expect(link).toBeNull();
	});

	// CL-768: the verify endpoint marks an unverified user verified on use, so a link for one
	// would skip email verification (and "verify" a row someone else may have pre-registered).
	it('mints nothing for an unverified user', async () => {
		vi.stubEnv('BETTER_AUTH_URL', 'https://app.example.com');
		const t = await setup({ emailVerified: false });

		const link = await t.run((ctx) =>
			mintMagicLink(ctx, {
				email: 'parent@example.com',
				callbackPath: '/child/abc',
				expiresInSeconds: EMAIL_MAGIC_LINK_SECONDS
			})
		);

		expect(link).toBeNull();
	});

	// Review S11: an email link must not be a no-password door into an admin session.
	it('mints nothing for a platform admin', async () => {
		vi.stubEnv('BETTER_AUTH_URL', 'https://app.example.com');
		const t = await setup({ platformAdmin: true });

		const link = await t.run((ctx) =>
			mintMagicLink(ctx, {
				email: 'parent@example.com',
				callbackPath: '/child/abc',
				expiresInSeconds: EMAIL_MAGIC_LINK_SECONDS
			})
		);

		expect(link).toBeNull();
	});

	it('mints nothing without BETTER_AUTH_URL (no absolute link to build)', async () => {
		vi.stubEnv('BETTER_AUTH_URL', '');
		const t = await setup();

		const link = await t.run((ctx) =>
			mintMagicLink(ctx, {
				email: 'parent@example.com',
				callbackPath: '/child/abc',
				expiresInSeconds: EMAIL_MAGIC_LINK_SECONDS
			})
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
		// Through the interstitial like every emailed link, with the plugin's own token.
		const emailed = email.text.match(/https:\/\/\S+/)![0];
		const link = new URL(emailed);
		expect(link.pathname).toBe('/auth/link');
		expect(link.search).toBe('');
		const verifyPath = interstitialToVerifyPath(emailed);

		const verify = await t.fetch(verifyPath, { method: 'GET' });
		expect(verify.status).toBe(302);
		expect(verify.headers.get('location')).toBe(
			'https://app.example.com/child/abc?room=xyz&via=link'
		);

		const reused = await t.fetch(verifyPath, { method: 'GET' });
		const fallback = new URL(reused.headers.get('location')!);
		expect(fallback.pathname).toBe('/auth/sign-in');
		expect(fallback.searchParams.get('next')).toBe('/child/abc?room=xyz');
		expect(fallback.searchParams.get('link')).toBe('expired');
	});

	it('answers the same but sends nothing to an unverified user', async () => {
		stubAuthEnv();
		const t = await setup({ emailVerified: false });

		const response = await requestLink(t, 'parent@example.com');
		expect(response.status).toBe(200);
		expect(sendEmailMock).not.toHaveBeenCalled();
	});

	it('answers the same but sends nothing to a platform admin', async () => {
		stubAuthEnv();
		const t = await setup({ platformAdmin: true });

		const response = await requestLink(t, 'parent@example.com');
		expect(response.status).toBe(200);
		expect(sendEmailMock).not.toHaveBeenCalled();
	});

	// Review edge case 16: a child's synthetic auth address is not an inbox. Neither a sign-in
	// link nor a password reset is sent to it, and both endpoints answer as usual.
	it('answers the same but emails nothing to a synthetic child address', async () => {
		stubAuthEnv();
		const t = await setup({ withUser: false });
		const now = Date.now();
		await t.mutation(components.betterAuth.adapter.create, {
			input: {
				model: 'user',
				data: {
					email: 'kiddo@children.curiosity.local',
					emailVerified: true,
					name: 'kiddo',
					createdAt: now,
					updatedAt: now
				}
			}
		});

		expect((await requestLink(t, 'kiddo@children.curiosity.local')).status).toBe(200);
		const reset = await t.fetch('/api/auth/request-password-reset', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				email: 'kiddo@children.curiosity.local',
				redirectTo: '/auth/reset-password'
			})
		});
		expect(reset.status).toBe(200);
		expect(sendEmailMock).not.toHaveBeenCalled();
		expect(
			await t.run((ctx) =>
				mintMagicLink(ctx, {
					email: 'kiddo@children.curiosity.local',
					callbackPath: '/',
					expiresInSeconds: EMAIL_MAGIC_LINK_SECONDS
				})
			)
		).toBeNull();
	});

	it('answers the same but sends nothing for an unknown address', async () => {
		stubAuthEnv();
		const t = await setup({ withUser: false });

		const response = await requestLink(t, 'stranger@example.com');
		expect(response.status).toBe(200);
		expect(sendEmailMock).not.toHaveBeenCalled();
	});
});

// CL-807: Settings' "Set a password" runs Better Auth's reset flow. An account without a password
// (a parent created at consent approval) gets "set a password" wording, not "reset".
describe('POST /request-password-reset wording', () => {
	const requestReset = (t: Awaited<ReturnType<typeof setup>>) =>
		t.fetch('/api/auth/request-password-reset', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ email: 'parent@example.com', redirectTo: '/auth/reset-password' })
		});

	it('asks an account without a password to set one', async () => {
		stubAuthEnv();
		const t = await setup();

		expect((await requestReset(t)).status).toBe(200);
		expect(sendEmailMock).toHaveBeenCalledTimes(1);
		expect(sendEmailMock.mock.calls[0][0]).toMatchObject({
			subject: 'Set a password for Curiosity Learning',
			text: expect.stringContaining('Choose a password for your Curiosity Learning account')
		});
	});

	it('keeps the reset wording for an account that has a password', async () => {
		stubAuthEnv();
		const t = await setup();
		const now = Date.now();
		const user = (await t.query(components.betterAuth.adapter.findOne, {
			model: 'user',
			where: [{ field: 'email', value: 'parent@example.com' }]
		})) as { _id: string };
		await t.mutation(components.betterAuth.adapter.create, {
			input: {
				model: 'account',
				data: {
					accountId: user._id,
					providerId: 'credential',
					userId: user._id,
					password: await hashPassword('a-long-password-1'),
					createdAt: now,
					updatedAt: now
				}
			}
		});

		expect((await requestReset(t)).status).toBe(200);
		expect(sendEmailMock).toHaveBeenCalledTimes(1);
		expect(sendEmailMock.mock.calls[0][0]).toMatchObject({ subject: 'Reset your password' });
	});
});

describe('POST /sign-in/magic-link per-address rate limit', () => {
	const requestLink = (t: Awaited<ReturnType<typeof setup>>, email: string) =>
		t.fetch('/api/auth/sign-in/magic-link', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ email, callbackURL: toMagicLinkCallbackParam('/') })
		});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('emails at most 5 links per address per hour, answering the same either way', async () => {
		stubAuthEnv();
		vi.useFakeTimers({ toFake: ['Date'] });
		const t = await setup();
		const now = Date.now();
		await t.mutation(components.betterAuth.adapter.create, {
			input: {
				model: 'user',
				data: {
					email: 'other@example.com',
					emailVerified: true,
					name: 'other',
					createdAt: now,
					updatedAt: now
				}
			}
		});

		for (let attempt = 0; attempt < 7; attempt++) {
			expect((await requestLink(t, 'Parent@Example.com')).status).toBe(200);
		}
		expect(sendEmailMock).toHaveBeenCalledTimes(5);

		// Another address has its own allowance.
		expect((await requestLink(t, 'other@example.com')).status).toBe(200);
		expect(sendEmailMock).toHaveBeenCalledTimes(6);

		vi.setSystemTime(now + 61 * 60 * 1000);
		expect((await requestLink(t, 'parent@example.com')).status).toBe(200);
		expect(sendEmailMock).toHaveBeenCalledTimes(7);
	});
});

describe('deleteExpiredVerifications (daily cron)', () => {
	it('deletes expired verification rows and keeps live ones', async () => {
		vi.stubEnv('BETTER_AUTH_URL', 'https://app.example.com');
		const t = await setup();
		const live = await mint(t);
		const expired = await mint(t);
		const expiredToken = parseMagicLinkInterstitialFragment(new URL(expired!).hash)!.token;
		const liveToken = parseMagicLinkInterstitialFragment(new URL(live!).hash)!.token;
		await t.mutation(components.betterAuth.adapter.updateOne, {
			input: {
				model: 'verification',
				where: [{ field: 'identifier', value: await pluginIdentifier(expiredToken) }],
				update: { expiresAt: Date.now() - 1000 }
			}
		});

		const result = await t.mutation(internal.magicLinks.deleteExpiredVerifications, {});

		expect(result).toEqual({ deleted: 1, hasMore: false });
		expect(await findVerification(t, await pluginIdentifier(expiredToken))).toBeNull();
		expect(await findVerification(t, await pluginIdentifier(liveToken))).not.toBeNull();
	});
});

// Review S4 (CL-769): sessions created by a sign-in link last 7 days, and Better Auth's session
// refresh (which would otherwise push any session back to the full 30 days on first use) keeps
// them there (auth.ts databaseHooks).
describe('sessions created by a sign-in link', () => {
	const DAY_MS = 24 * 60 * 60 * 1000;
	type SessionRow = { token: string; expiresAt: number; createdAt: number };
	const sessionsOf = async (t: Awaited<ReturnType<typeof setup>>) =>
		(
			(await t.query(components.betterAuth.adapter.findMany, {
				model: 'session',
				where: [],
				paginationOpts: { cursor: null, numItems: 10 }
			})) as { page: SessionRow[] }
		).page;
	const sessionCookie = (response: Response) =>
		response.headers
			.get('set-cookie')!
			.split(/,(?=\s*[\w.-]+=)/)
			.map((cookie) => cookie.trim().split(';')[0])
			.find((cookie) => /^(__Secure-)?better-auth\.session_token=/.test(cookie))!;

	it('last 7 days, and a session refresh does not extend them', async () => {
		stubAuthEnv();
		const t = await setup();
		const before = Date.now();
		const verify = await t.fetch(interstitialToVerifyPath((await mint(t))!), { method: 'GET' });
		expect(verify.status).toBe(302);

		const [created] = await sessionsOf(t);
		expect(created.expiresAt).toBeGreaterThanOrEqual(before + 7 * DAY_MS);
		expect(created.expiresAt).toBeLessThanOrEqual(Date.now() + 7 * DAY_MS);

		// For a 7-day session getSession's refresh condition is already true: it rewrites
		// expiresAt, and the hook keeps it at createdAt + 7 days.
		const session = await t.fetch('/api/auth/get-session', {
			method: 'GET',
			headers: { cookie: sessionCookie(verify) }
		});
		expect(session.status).toBe(200);
		expect(((await session.json()) as { user?: { email: string } } | null)?.user?.email).toBe(
			'parent@example.com'
		);
		const [refreshed] = await sessionsOf(t);
		expect(refreshed.token).toBe(created.token);
		expect(refreshed.expiresAt).toBeLessThanOrEqual(created.createdAt + 7 * DAY_MS);
		expect(refreshed.expiresAt).toBeGreaterThanOrEqual(created.createdAt + 7 * DAY_MS - 1000);
	});

	// Settings' "Sign out everywhere" (CL-769): revoke-other-sessions, then a local sign-out.
	it('can all be ended from another device through revoke-other-sessions', async () => {
		stubAuthEnv();
		const t = await setup();
		const first = await t.fetch(interstitialToVerifyPath((await mint(t))!), { method: 'GET' });
		const second = await t.fetch(interstitialToVerifyPath((await mint(t))!), { method: 'GET' });
		expect(await sessionsOf(t)).toHaveLength(2);

		const revoke = await t.fetch('/api/auth/revoke-other-sessions', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				origin: 'https://app.example.com',
				cookie: sessionCookie(second)
			},
			body: '{}'
		});
		expect(revoke.status).toBe(200);
		const remaining = await sessionsOf(t);
		expect(remaining).toHaveLength(1);
		const stale = await t.fetch('/api/auth/get-session', {
			method: 'GET',
			headers: { cookie: sessionCookie(first) }
		});
		expect(await stale.json()).toBeNull();
	});

	it('other sign-ins keep the normal 30 days', async () => {
		stubAuthEnv();
		const t = await setup({ withUser: false });
		const now = Date.now();
		const user = (await t.mutation(components.betterAuth.adapter.create, {
			input: {
				model: 'user',
				data: {
					email: 'adult@example.com',
					emailVerified: true,
					name: 'adult',
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
					password: await hashPassword('a-long-password-1'),
					createdAt: now,
					updatedAt: now
				}
			}
		});

		const signIn = await t.fetch('/api/auth/sign-in/email', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ email: 'adult@example.com', password: 'a-long-password-1' })
		});
		expect(signIn.status).toBe(200);

		const [created] = await sessionsOf(t);
		expect(created.expiresAt).toBeGreaterThanOrEqual(now + 30 * DAY_MS);
	});
});

// CL-815: links minted under Better Auth 1.4.9 sit in parents' inboxes for up to 48 hours. The
// migration rewrites their rows into the 1.7 shape so they keep signing in after the deploy.
describe('migrateLegacyMagicLinkVerifications (CL-815 deploy step)', () => {
	const LEGACY_TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEF';

	const insertVerification = async (
		t: Awaited<ReturnType<typeof setup>>,
		row: { identifier: string; value: string; expiresAt?: number }
	) => {
		const now = Date.now();
		await t.mutation(components.betterAuth.adapter.create, {
			input: {
				model: 'verification',
				data: {
					identifier: row.identifier,
					value: row.value,
					expiresAt: row.expiresAt ?? now + 60 * 60 * 1000,
					createdAt: now,
					updatedAt: now
				}
			}
		});
	};

	it('recognises only the 1.4.9 magic-link row shape', async () => {
		const hash = await pluginKeyHasher(LEGACY_TOKEN);
		expect(toMigratedMagicLinkRow({ identifier: hash, value: '{"email":"a@b.co"}' })).toEqual({
			identifier: `magic-link:${hash}`,
			value: JSON.stringify({ type: 'magic-link', email: 'a@b.co' })
		});
		expect(
			toMigratedMagicLinkRow({ identifier: hash, value: '{"email":"a@b.co","name":"A"}' })
		).toEqual({
			identifier: `magic-link:${hash}`,
			value: JSON.stringify({ type: 'magic-link', email: 'a@b.co', name: 'A' })
		});
		// Already migrated / written by 1.7.
		expect(
			toMigratedMagicLinkRow({
				identifier: `magic-link:${hash}`,
				value: JSON.stringify({ type: 'magic-link', email: 'a@b.co' })
			})
		).toBeNull();
		// Other flows' rows.
		expect(toMigratedMagicLinkRow({ identifier: 'reset-password:abc', value: 'user1' })).toBeNull();
		expect(
			toMigratedMagicLinkRow({ identifier: 'sign-in-otp-a@b.co', value: '123456:0' })
		).toBeNull();
		// Right identifier shape, wrong value shapes.
		expect(toMigratedMagicLinkRow({ identifier: hash, value: 'user1' })).toBeNull();
		expect(
			toMigratedMagicLinkRow({ identifier: hash, value: '{"email":"a@b.co","x":1}' })
		).toBeNull();
		expect(toMigratedMagicLinkRow({ identifier: hash, value: '["a@b.co"]' })).toBeNull();
	});

	it('makes a link minted before the upgrade sign in again, and leaves other rows alone', async () => {
		stubAuthEnv();
		const t = await setup();
		const hash = await pluginKeyHasher(LEGACY_TOKEN);
		// Exactly what 1.4.9's mintMagicLink stored.
		await insertVerification(t, {
			identifier: hash,
			value: JSON.stringify({ email: 'parent@example.com' })
		});
		await insertVerification(t, { identifier: 'reset-password:resettoken', value: 'someone' });
		const verifyPath = buildMagicLinkVerifyPath({ token: LEGACY_TOKEN, next: '/child/abc' });

		// Before the migration the 1.7 verify endpoint cannot find the legacy row.
		const before = await t.fetch(verifyPath, { method: 'GET' });
		expect(new URL(before.headers.get('location')!).searchParams.get('error')).toBe(
			'INVALID_TOKEN'
		);

		const result = await t.mutation(internal.magicLinks.migrateLegacyMagicLinkVerifications, {});
		expect(result).toEqual({ migrated: 1, isDone: true });
		expect(await findVerification(t, hash)).toBeNull();
		expect((await findVerification(t, 'reset-password:resettoken'))?.value).toBe('someone');

		const after = await t.fetch(verifyPath, { method: 'GET' });
		expect(after.status).toBe(302);
		expect(after.headers.get('location')).toBe('https://app.example.com/child/abc?via=link');
		expect(after.headers.get('set-cookie')).toContain('better-auth.session_token=');

		// Idempotent.
		expect(await t.mutation(internal.magicLinks.migrateLegacyMagicLinkVerifications, {})).toEqual({
			migrated: 0,
			isDone: true
		});
	});

	it('skips expired legacy rows (the daily cleanup removes them)', async () => {
		vi.stubEnv('BETTER_AUTH_URL', 'https://app.example.com');
		const t = await setup();
		const hash = await pluginKeyHasher(LEGACY_TOKEN);
		await insertVerification(t, {
			identifier: hash,
			value: JSON.stringify({ email: 'parent@example.com' }),
			expiresAt: Date.now() - 1000
		});

		const result = await t.mutation(internal.magicLinks.migrateLegacyMagicLinkVerifications, {});

		expect(result).toEqual({ migrated: 0, isDone: true });
		expect(await findVerification(t, hash)).not.toBeNull();
	});
});

// CL-815 regression tests for the advisories the upgrade fixes.
describe('Better Auth security advisories (CL-815)', () => {
	// GHSA-qq9h-g4jm-xgf3: someone pre-registers the victim's address with a password they know.
	// On 1.4.9 that password started working once the real owner proved the mailbox through an
	// email code. 1.7 removes every unproven credential when the mailbox is first proven.
	it('an email-code sign-in strips a password set before the address was proven', async () => {
		stubAuthEnv();
		const t = await setup({ emailVerified: false });
		const user = (await t.query(components.betterAuth.adapter.findOne, {
			model: 'user',
			where: [{ field: 'email', value: 'parent@example.com' }]
		})) as { _id: string };
		const now = Date.now();
		await t.mutation(components.betterAuth.adapter.create, {
			input: {
				model: 'account',
				data: {
					accountId: user._id,
					providerId: 'credential',
					userId: user._id,
					password: await hashPassword('attacker-password-1'),
					createdAt: now,
					updatedAt: now
				}
			}
		});
		const json = { 'content-type': 'application/json', origin: 'https://app.example.com' };

		const send = await t.fetch('/api/auth/email-otp/send-verification-otp', {
			method: 'POST',
			headers: json,
			body: JSON.stringify({ email: 'parent@example.com', type: 'sign-in' })
		});
		expect(send.status).toBe(200);
		const otp = sendEmailMock.mock.calls.at(-1)![0].text.match(/\b(\d{6})\b/)![1];

		const signIn = await t.fetch('/api/auth/sign-in/email-otp', {
			method: 'POST',
			headers: json,
			body: JSON.stringify({ email: 'parent@example.com', otp })
		});
		expect(signIn.status).toBe(200);

		const accounts = (await t.query(components.betterAuth.adapter.findMany, {
			model: 'account',
			where: [{ field: 'userId', value: user._id }],
			paginationOpts: { cursor: null, numItems: 10 }
		})) as { page: Array<{ providerId: string }> };
		expect(accounts.page.map((account) => account.providerId)).not.toContain('credential');
		const attacker = await t.fetch('/api/auth/sign-in/email', {
			method: 'POST',
			headers: json,
			body: JSON.stringify({ email: 'parent@example.com', password: 'attacker-password-1' })
		});
		expect(attacker.status).toBe(401);
	});

	// GHSA-g38m-r43w-p2q7: Google sign-in must not link itself to an unverified local account.
	it('pins accountLinking.requireLocalEmailVerified', async () => {
		stubAuthEnv();
		const { createAuth } = await import('./auth');
		const auth = createAuth({} as Parameters<typeof createAuth>[0]);
		expect(auth.options.account?.accountLinking?.requireLocalEmailVerified).toBe(true);
	});
});

// CL-815 (QA blocker): @convex-dev/better-auth 0.13 expires the convex_jwt cookie on every
// request that starts a session, so the first server-rendered page after a sign-in has only the
// session cookie. hooks.server.ts resolves the Convex token from it (lib/server/convex-token.ts);
// these run that resolver against the real component with the cookies the browser holds right
// after a password sign-in and right after a magic-link click.
describe('first SSR request after a sign-in gets a Convex token (CL-815)', () => {
	type Jar = Map<string, string>;

	// What the browser keeps from a response's Set-Cookie headers.
	const applySetCookies = (target: Jar, response: Response) => {
		for (const header of response.headers.getSetCookie()) {
			const parsed = parseSetCookie(header);
			if (!parsed) continue;
			if (!parsed.value || parsed.options.maxAge === 0) target.delete(parsed.name);
			else target.set(parsed.name, parsed.value);
		}
	};

	const cookiesOf = (target: Jar) => ({
		get: (name: string) => target.get(name),
		set: (name: string, value: string) => {
			target.set(name, value);
		}
	});

	const cookieHeader = (target: Jar) =>
		[...target].map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join('; ');

	const resolveFor = (t: Awaited<ReturnType<typeof setup>>, target: Jar) =>
		resolveConvexToken({
			cookies: cookiesOf(target),
			requestHeaders: new Headers({ cookie: cookieHeader(target) }),
			requestUrl: new URL('https://app.example.com/feed/my-clubs'),
			convexSiteUrl: 'https://site.example.com',
			// convex-test serves the app's http routes by path.
			fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = new URL(String(input));
				return t.fetch(`${url.pathname}${url.search}`, init);
			}) as typeof globalThis.fetch
		});

	const jwtPayload = (token: string) =>
		JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()) as {
			sub: string;
			sessionId: string;
		};

	const expectTokenForSession = async (
		t: Awaited<ReturnType<typeof setup>>,
		target: Jar,
		userId: string
	) => {
		// The problem being fixed: a session cookie, but no Convex JWT cookie.
		const names = [...target.keys()];
		expect(names.some((name) => name.endsWith('session_token'))).toBe(true);
		expect(names.some((name) => name.endsWith('convex_jwt'))).toBe(false);

		const token = await resolveFor(t, target);

		expect(token).toBeTruthy();
		const payload = jwtPayload(token!);
		expect(payload.sub).toBe(userId);
		const sessions = (await t.query(components.betterAuth.adapter.findMany, {
			model: 'session',
			where: [{ field: 'userId', value: userId }],
			paginationOpts: { cursor: null, numItems: 10 }
		})) as { page: Array<{ _id: string }> };
		expect(sessions.page.map((session) => session._id)).toContain(payload.sessionId);
		// Kept for the next requests, which then read it straight from the cookie.
		expect([...target.keys()].some((name) => name.endsWith('convex_jwt'))).toBe(true);
	};

	const userIdOf = async (t: Awaited<ReturnType<typeof setup>>) =>
		(
			(await t.query(components.betterAuth.adapter.findOne, {
				model: 'user',
				where: [{ field: 'email', value: 'parent@example.com' }]
			})) as { _id: string }
		)._id;

	it('after an email + password sign-in', async () => {
		stubAuthEnv();
		const t = await setup();
		const userId = await userIdOf(t);
		const now = Date.now();
		await t.mutation(components.betterAuth.adapter.create, {
			input: {
				model: 'account',
				data: {
					accountId: userId,
					providerId: 'credential',
					userId,
					password: await hashPassword('a-long-password-1'),
					createdAt: now,
					updatedAt: now
				}
			}
		});
		const target: Jar = new Map();
		const signIn = await t.fetch('/api/auth/sign-in/email', {
			method: 'POST',
			headers: { 'content-type': 'application/json', origin: 'https://app.example.com' },
			body: JSON.stringify({ email: 'parent@example.com', password: 'a-long-password-1' })
		});
		expect(signIn.status).toBe(200);
		applySetCookies(target, signIn);

		await expectTokenForSession(t, target, userId);
	});

	it('after a magic-link click', async () => {
		stubAuthEnv();
		const t = await setup();
		const userId = await userIdOf(t);
		const target: Jar = new Map();
		const verify = await t.fetch(interstitialToVerifyPath((await mint(t))!), { method: 'GET' });
		expect(verify.status).toBe(302);
		applySetCookies(target, verify);

		await expectTokenForSession(t, target, userId);
	});

	it('a signed-out browser (stale session cookie) gets no token', async () => {
		stubAuthEnv();
		const t = await setup();
		const target: Jar = new Map([['better-auth.session_token', 'not-a-session.sig']]);

		expect(await resolveFor(t, target)).toBeUndefined();
	});
});
