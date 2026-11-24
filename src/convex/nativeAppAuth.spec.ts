/// <reference types="vite/client" />

// CL-819 spike: the native app's auth path against the real betterAuth component. The client
// side is the real crossDomainClient over the Keychain-style synchronous cache, with convex-test's
// t.fetch standing in for the network, so the Better-Auth-Cookie round trip is the real one.

import betterAuthTest from '@convex-dev/better-auth/test';
import { crossDomainClient, convexClient } from '@convex-dev/better-auth/client/plugins';
import { createAuthClient } from 'better-auth/client';
import { hashPassword } from 'better-auth/crypto';
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { components } from './_generated/api';
import schema from './schema';
import { pluginVerifyUrlToInterstitial } from './magicLinks';
import { parseIncomingLink } from '../capacitor-spike/lib/deep-links';
import {
	NATIVE_APP_ORIGINS,
	googleClientIds,
	isNativeAppAuthEnabled,
	nativeAppCorsOrigins,
	nativeAppTrustedOrigins
} from './nativeAppAuth';
import {
	createMemorySecureStore,
	createSyncStorageCache
} from '../capacitor-spike/lib/secure-storage-cache';

const modules = import.meta.glob('./**/*.ts');

// Better Auth skips its whole Origin/CSRF check when NODE_ENV is "test" or TEST is set
// (create-context.mjs: skipOriginCheck = isTest()), and reads NODE_ENV once at import. This spec
// is about exactly that check, so Better Auth must believe it runs in production. Hoisted above
// the imports; vitest isolates the environment per spec file.
vi.hoisted(() => {
	process.env.NODE_ENV = 'production';
	delete process.env.TEST;
});

const { sendEmailMock } = vi.hoisted(() => ({
	sendEmailMock: vi.fn<(email: { to: string; type: string; text: string }) => Promise<unknown>>(
		async () => ({ providerMessageId: 'resend-msg-1' })
	)
}));

vi.mock('./email/resend', () => ({
	sendEmail: sendEmailMock
}));

const SITE = 'https://site.example.com';
const PASSWORD = 'native-app-password-1';

const stubAuthEnv = (nativeAppAuth: boolean) => {
	vi.stubEnv('BETTER_AUTH_URL', 'https://app.example.com');
	vi.stubEnv('CONVEX_SITE_URL', SITE);
	vi.stubEnv('BETTER_AUTH_SECRET', 'test-secret-'.repeat(4));
	vi.stubEnv('NATIVE_APP_AUTH', nativeAppAuth ? 'true' : '');
};

afterEach(() => {
	vi.unstubAllEnvs();
	sendEmailMock.mockClear();
});

describe('native app auth settings', () => {
	it('is off unless NATIVE_APP_AUTH=true', () => {
		expect(isNativeAppAuthEnabled({})).toBe(false);
		expect(isNativeAppAuthEnabled({ NATIVE_APP_AUTH: '1' })).toBe(false);
		expect(nativeAppTrustedOrigins({})).toEqual([]);
		expect(nativeAppCorsOrigins({})).toEqual([]);
	});

	it('adds exactly the two Capacitor WebView origins when on', () => {
		const env = { NATIVE_APP_AUTH: 'true' };
		expect(nativeAppTrustedOrigins(env)).toEqual(['capacitor://localhost', 'https://localhost']);
		expect(nativeAppCorsOrigins(env)).toEqual([...NATIVE_APP_ORIGINS]);
	});

	it('accepts the web and iOS Google audiences, web first, only when on', () => {
		const base = { GOOGLE_CLIENT_ID: 'web.apps', GOOGLE_IOS_CLIENT_ID: 'ios.apps' };
		expect(googleClientIds(base)).toBe('web.apps');
		expect(googleClientIds({ ...base, NATIVE_APP_AUTH: 'true' })).toEqual(['web.apps', 'ios.apps']);
		expect(googleClientIds({ GOOGLE_IOS_CLIENT_ID: 'ios.apps', NATIVE_APP_AUTH: 'true' })).toBe(
			undefined
		);
	});
});

// Production mode also turns on Better Auth's in-memory per-IP rate limiter, shared by every
// test in this file: each request gets its own client address.
let requestCount = 0;
const nextClientIp = () => {
	requestCount += 1;
	return `10.${(requestCount >> 16) & 255}.${(requestCount >> 8) & 255}.${requestCount & 255}`;
};

const setup = async () => {
	const t = convexTest(schema, modules);
	betterAuthTest.register(t);
	const rawFetch = t.fetch.bind(t);
	t.fetch = (path, init) => {
		const headers = new Headers(init?.headers);
		headers.set('x-forwarded-for', nextClientIp());
		return rawFetch(path, { ...init, headers });
	};
	const now = Date.now();
	const user = (await t.mutation(components.betterAuth.adapter.create, {
		input: {
			model: 'user',
			data: {
				email: 'parent@example.com',
				emailVerified: true,
				name: 'Native Parent',
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
	const sessions = async () =>
		(
			(await t.query(components.betterAuth.adapter.findMany, {
				model: 'session',
				where: [{ field: 'userId', value: user._id }],
				paginationOpts: { cursor: null, numItems: 10 }
			})) as { page: Array<{ token: string }> }
		).page;
	return { t, user, sessions };
};

type T = Awaited<ReturnType<typeof setup>>['t'];

const preflight = (t: T, origin: string) =>
	t.fetch('/api/auth/sign-in/email', {
		method: 'OPTIONS',
		headers: {
			origin,
			'access-control-request-method': 'POST',
			'access-control-request-headers': 'content-type,better-auth-cookie'
		}
	});

describe('native app CORS on /api/auth (flag on)', () => {
	beforeEach(() => stubAuthEnv(true));

	it.each(NATIVE_APP_ORIGINS)('answers the preflight for %s', async (origin) => {
		const { t } = await setup();
		const response = await preflight(t, origin);
		expect(response.status).toBe(204);
		expect(response.headers.get('access-control-allow-origin')).toBe(origin);
		expect(response.headers.get('access-control-allow-headers')).toContain('Better-Auth-Cookie');
		// The native client omits credentials; the CORS policy never allows them.
		expect(response.headers.get('access-control-allow-credentials')).toBeNull();
	});

	it.each([
		'https://evil.example',
		'capacitor://evil',
		'http://localhost',
		'https://localhost:8443',
		// Trusted for CSRF (web dev), but never needs CORS: the web app proxies same-origin.
		'http://localhost:5173',
		'https://app.example.com'
	])('gives %s no Access-Control-Allow-Origin', async (origin) => {
		const { t } = await setup();
		const response = await preflight(t, origin);
		expect(response.headers.get('access-control-allow-origin')).toBeNull();
		const get = await t.fetch('/api/auth/ok', { headers: { origin } });
		expect(get.headers.get('access-control-allow-origin')).toBeNull();
	});

	// Spike finding (question 7): Better Auth's Origin check (origin-check.mjs validateOrigin)
	// runs only when the raw request has a `Cookie` header. The crossDomain plugin turns
	// Better-Auth-Cookie into a cookie in a later hook, so header-carried sessions are never
	// origin-checked, from any origin. That is safe for this transport: a browser never attaches
	// the header on its own (no ambient credential, so no CSRF), and a page on another origin
	// cannot read Set-Better-Auth-Cookie because CORS gives it no allow-origin (above). So CORS,
	// not trustedOrigins, is what keeps other origins out. Pinned here so a Better Auth upgrade
	// that changes it fails loudly.
	it('does not origin-check header-cookie requests (CORS is the gate)', async () => {
		const { t, sessions } = await setup();
		const signIn = await t.fetch('/api/auth/sign-in/email', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				origin: 'capacitor://localhost',
				'better-auth-cookie': ''
			},
			body: JSON.stringify({ email: 'parent@example.com', password: PASSWORD })
		});
		expect(signIn.status).toBe(200);
		const setCookie = signIn.headers.get('set-better-auth-cookie') ?? '';
		const cookie = setCookie.match(/__Secure-better-auth\.session_token=[^;]+/)?.[0] ?? '';
		expect(cookie).not.toBe('');

		// A real Cookie header from an untrusted origin is refused (the web's CSRF guard)…
		const cookieFromEvil = await t.fetch('/api/auth/sign-out', {
			method: 'POST',
			headers: { 'content-type': 'application/json', origin: 'https://evil.example', cookie },
			body: '{}'
		});
		expect(cookieFromEvil.status).toBe(403);
		expect(await sessions()).toHaveLength(1);

		// …but the same session in Better-Auth-Cookie is accepted from that origin.
		const headerFromEvil = await t.fetch('/api/auth/sign-out', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				origin: 'https://evil.example',
				'better-auth-cookie': cookie
			},
			body: '{}'
		});
		expect(headerFromEvil.status).toBe(200);
		expect(headerFromEvil.headers.get('access-control-allow-origin')).toBeNull();
		expect(await sessions()).toHaveLength(0);
	});
});

describe('native app CORS on /api/auth (flag off)', () => {
	beforeEach(() => stubAuthEnv(false));

	it('gives the native origins no CORS and no header-cookie session', async () => {
		const { t } = await setup();
		const response = await preflight(t, 'capacitor://localhost');
		expect(response.headers.get('access-control-allow-origin')).toBeNull();
		const post = await t.fetch('/api/auth/sign-in/email', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				origin: 'capacitor://localhost',
				'better-auth-cookie': ''
			},
			body: JSON.stringify({ email: 'parent@example.com', password: PASSWORD })
		});
		// Without the crossDomain plugin the session only goes out as a real Set-Cookie, which a
		// WebView fetch with credentials: 'omit' to another site can never store or send back.
		expect(post.headers.get('set-better-auth-cookie')).toBeNull();
		expect(post.headers.get('access-control-allow-origin')).toBeNull();
	});
});

// The real native client: crossDomainClient + the synchronous Keychain-style cache, talking to the
// test deployment through t.fetch, from a WebView origin.
const nativeClient = (t: T, origin: string, store = createMemorySecureStore()) => {
	const storage = createSyncStorageCache(store, ['better-auth_cookie', 'better-auth_session_data']);
	const client = createAuthClient({
		baseURL: SITE,
		plugins: [convexClient(), crossDomainClient({ storage })],
		fetchOptions: {
			customFetchImpl: async (input, init) => {
				const url = new URL(input instanceof Request ? input.url : String(input));
				const headers = new Headers(init?.headers);
				headers.set('origin', origin);
				return t.fetch(`${url.pathname}${url.search}`, { ...init, headers });
			}
		}
	});
	return { client, storage, store };
};

describe('native app session over Better-Auth-Cookie (flag on)', () => {
	beforeEach(() => stubAuthEnv(true));

	it.each(NATIVE_APP_ORIGINS)(
		'%s: password sign-in → stored cookie → Convex JWT → sign-out revokes the session row',
		async (origin) => {
			const { t, sessions } = await setup();
			const { client, storage, store } = nativeClient(t, origin);
			await storage.hydrate();

			const signIn = await client.signIn.email({ email: 'parent@example.com', password: PASSWORD });
			expect(signIn.error).toBeNull();
			await storage.flush();
			// The session travels in the header, never as a real cookie; it landed in the secure store.
			expect(client.getCookie()).toMatch(/better-auth\.session_token=/);
			expect(store.snapshot()['better-auth_cookie']).toContain('session_token');
			expect(await sessions()).toHaveLength(1);

			const session = await client.getSession();
			expect(session.data?.user.email).toBe('parent@example.com');

			const token = await client.$fetch<{ token: string }>('/convex/token', { method: 'GET' });
			const jwt = token.data?.token ?? '';
			expect(jwt.split('.')).toHaveLength(3);
			const claims = JSON.parse(Buffer.from(jwt.split('.')[1]!, 'base64url').toString()) as {
				sub: string;
			};
			expect(claims.sub).toBeTruthy();

			// Relaunch: a new client over the same secure store is still signed in.
			const relaunched = nativeClient(t, origin, store);
			await relaunched.storage.hydrate();
			expect((await relaunched.client.getSession()).data?.user.email).toBe('parent@example.com');

			const oldCookie = client.getCookie();
			await client.signOut();
			await storage.flush();
			expect(await sessions()).toHaveLength(0);
			// The server's clearing Set-Cookie leaves only empty values behind.
			expect(client.getCookie()).not.toMatch(/session_token=[^;]/);
			const replay = await t.fetch('/api/auth/get-session', {
				headers: { origin, 'better-auth-cookie': oldCookie }
			});
			expect(await replay.json()).toBeNull();
		}
	);

	it('web cookie sign-in is unchanged with the plugin on (Set-Cookie, no header cookie)', async () => {
		const { t } = await setup();
		const response = await t.fetch('/api/auth/sign-in/email', {
			method: 'POST',
			headers: { 'content-type': 'application/json', origin: 'https://app.example.com' },
			body: JSON.stringify({ email: 'parent@example.com', password: PASSWORD })
		});
		expect(response.status).toBe(200);
		expect(response.headers.get('set-cookie')).toContain('better-auth.session_token=');
		expect(response.headers.get('set-better-auth-cookie')).toBeNull();
	});
});

describe('native app sign-in links (flag on)', () => {
	beforeEach(() => stubAuthEnv(true));

	it('keeps the /auth/link interstitial when crossDomain made the callback absolute', () => {
		const verify = (callbackURL: string) =>
			`https://app.example.com/api/auth/magic-link/verify?token=abcDEF123&callbackURL=${encodeURIComponent(callbackURL)}`;
		const sameOrigin = pluginVerifyUrlToInterstitial(
			verify('https://app.example.com/dashboard?x=1'),
			'parent@example.com'
		);
		expect(sameOrigin).toMatch(/^https:\/\/app\.example\.com\/auth\/link#/);
		expect(parseIncomingLink(sameOrigin!, 'https://app.example.com')).toMatchObject({
			kind: 'magic-link',
			token: 'abcDEF123',
			next: '/dashboard?x=1'
		});
		expect(
			pluginVerifyUrlToInterstitial(verify('https://evil.example/x'), 'parent@example.com')
		).toBeNull();
	});

	const requestLink = async (t: T, origin: string) => {
		const { client, storage } = nativeClient(t, origin);
		await storage.hydrate();
		const sent = await client.signIn.magicLink({ email: 'parent@example.com' });
		expect(sent.error).toBeNull();
		expect(sendEmailMock).toHaveBeenCalledTimes(1);
		const text = sendEmailMock.mock.calls[0]![0].text;
		const link = text.match(/https:\/\/app\.example\.com\/auth\/link#\S+/)?.[0];
		expect(link).toBeTruthy();
		const parsed = parseIncomingLink(link!, 'https://app.example.com');
		if (parsed.kind !== 'magic-link') throw new Error(`unexpected link ${link}`);
		return { client, storage, token: parsed.token };
	};

	it.each(NATIVE_APP_ORIGINS)(
		'%s: the emailed link opens the app, which verifies the token itself (no redirect)',
		async (origin) => {
			const { t, sessions } = await setup();
			const { client, storage, token } = await requestLink(t, origin);

			const verified = await client.$fetch('/magic-link/verify', {
				method: 'GET',
				query: { token }
			});
			expect(verified.error).toBeNull();
			await storage.flush();
			expect((await client.getSession()).data?.user.email).toBe('parent@example.com');
			expect(await sessions()).toHaveLength(1);
		}
	);

	it('a link verified in the browser redirects to the app origin with a one-time token the app swaps', async () => {
		const { t, sessions } = await setup();
		const { client, storage, token } = await requestLink(t, 'capacitor://localhost');

		// The browser path: verify with an absolute callback on the link domain.
		const callbackURL = 'https://app.example.com/app/auth-callback';
		const redirect = await t.fetch(
			`/api/auth/magic-link/verify?token=${token}&callbackURL=${encodeURIComponent(callbackURL)}`,
			{ redirect: 'manual' }
		);
		expect(redirect.status).toBe(302);
		const location = redirect.headers.get('location') ?? '';
		const incoming = parseIncomingLink(location, 'https://app.example.com');
		expect(incoming.kind).toBe('one-time-token');
		if (incoming.kind !== 'one-time-token') return;

		const swapped = await client.$fetch('/cross-domain/one-time-token/verify', {
			method: 'POST',
			body: { token: incoming.token }
		});
		expect(swapped.error).toBeNull();
		await storage.flush();
		expect((await client.getSession()).data?.user.email).toBe('parent@example.com');
		// One-time: a second swap fails.
		const again = await client.$fetch('/cross-domain/one-time-token/verify', {
			method: 'POST',
			body: { token: incoming.token }
		});
		expect(again.error).not.toBeNull();
		expect(await sessions()).toHaveLength(1);
	});
});
