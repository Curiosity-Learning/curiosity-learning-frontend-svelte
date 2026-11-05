/// <reference types="vite/client" />

// magicLinks.mintMagicLink writes Better Auth magic-link verification rows directly instead of
// going through the plugin's endpoint. These specs mount the real betterAuth component and pin
// the row to the exact shape the plugin's verify endpoint reads (better-auth 1.4.9,
// plugins/magic-link/index.mjs + utils.mjs, with storeToken: 'hashed'). If a Better Auth upgrade
// changes that contract, these must fail before parents' sign-in links do.

import betterAuthTest from '@convex-dev/better-auth/test';
import { createHash } from '@better-auth/utils/hash';
import { base64Url } from '@better-auth/utils/base64';
import { hashPassword } from 'better-auth/crypto';
import { convexTest } from 'convex-test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { components } from './_generated/api';
import { hashMagicLinkToken, mintMagicLink } from './magicLinks';
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
	it('hands out the /auth/link interstitial with token, next and masked address in the fragment', async () => {
		vi.stubEnv('BETTER_AUTH_URL', 'https://app.example.com');
		const t = await setup();

		const link = await mint(t);

		const url = new URL(link!);
		expect(`${url.origin}${url.pathname}`).toBe('https://app.example.com/auth/link');
		expect(url.search).toBe('');
		const parsed = parseMagicLinkInterstitialFragment(url.hash);
		expect(parsed?.token).toMatch(/^[a-zA-Z]{32}$/);
		expect(parsed?.next).toBe('/child/abc?room=xyz');
		expect(parsed?.as).toBe('p…@example.com');
		// What the interstitial's button opens: the verify endpoint with callbacks whose extra
		// decodeURIComponent() yields exactly the intended paths.
		const verify = new URL(interstitialToVerifyPath(link!), 'https://app.example.com');
		expect(verify.pathname).toBe('/api/auth/magic-link/verify');
		// The landing page is marked as reached through a sign-in link (CL-769 banner).
		expect(decodeURIComponent(verify.searchParams.get('callbackURL')!)).toBe(
			'/child/abc?room=xyz&via=link'
		);
		expect(decodeURIComponent(verify.searchParams.get('errorCallbackURL')!)).toBe(
			'/auth/sign-in?next=%2Fchild%2Fabc%3Froom%3Dxyz&link=expired'
		);
	});

	it('stores the row the magic-link plugin reads: hashed identifier, email JSON, the given lifetime', async () => {
		vi.stubEnv('BETTER_AUTH_URL', 'https://app.example.com');
		const t = await setup();
		const before = Date.now();

		const link = await mint(t, '/child/abc', 30 * 60);
		const token = parseMagicLinkInterstitialFragment(new URL(link!).hash)!.token;

		// storeToken: 'hashed' → the plugin looks the row up by its own hash of the token.
		const identifier = await pluginKeyHasher(token);
		expect(await hashMagicLinkToken(token)).toBe(identifier);
		const row = await findVerification(t, identifier);
		expect(row).not.toBeNull();
		// Never the raw token at rest.
		expect(await findVerification(t, token)).toBeNull();
		// verify: JSON.parse(value) → { email, name } → findUserByEmail(email).
		expect(JSON.parse(row!.value)).toEqual({ email: 'parent@example.com' });
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

	// Review S10: the verify endpoint decodes callback params a second time and we escape for
	// it (toMagicLinkCallbackParam). If an upgrade drops that extra decode, the error redirect's
	// `next` would keep a literal %25 and silently send the user to "/" — this pins it.
	it('an expired link redirects to the sign-in fallback with EXPIRED_TOKEN and `next` intact, query included', async () => {
		stubAuthEnv();
		const t = await setup();
		const link = (await mint(t, '/child/abc?room=xyz'))!;
		const verifyPath = interstitialToVerifyPath(link);
		const token = parseMagicLinkInterstitialFragment(new URL(link).hash)!.token;
		await t.mutation(components.betterAuth.adapter.updateOne, {
			input: {
				model: 'verification',
				where: [{ field: 'identifier', value: await hashMagicLinkToken(token) }],
				update: { expiresAt: Date.now() - 1000 }
			}
		});

		const response = await t.fetch(verifyPath, { method: 'GET' });
		expect(response.status).toBe(302);
		const fallback = new URL(response.headers.get('location')!);
		expect(fallback.pathname).toBe('/auth/sign-in');
		expect(fallback.searchParams.get('error')).toBe('EXPIRED_TOKEN');
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
				where: [{ field: 'identifier', value: await hashMagicLinkToken(expiredToken) }],
				update: { expiresAt: Date.now() - 1000 }
			}
		});

		const result = await t.mutation(internal.magicLinks.deleteExpiredVerifications, {});

		expect(result).toEqual({ deleted: 1, hasMore: false });
		expect(await findVerification(t, await hashMagicLinkToken(expiredToken))).toBeNull();
		expect(await findVerification(t, await hashMagicLinkToken(liveToken))).not.toBeNull();
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
