import { describe, expect, it, vi } from 'vitest';
import {
	hasSessionCookie,
	parseSetCookie,
	readConvexJwtCookie,
	resolveConvexToken,
	type TokenCookies
} from './convex-token';

const jar = (initial: Record<string, string>) => {
	const values = new Map(Object.entries(initial));
	const set = vi.fn((name: string, value: string) => {
		values.set(name, value);
	});
	const cookies: TokenCookies = { get: (name) => values.get(name), set };
	return { cookies, set, values };
};

const requestHeaders = (cookies: Record<string, string>) =>
	new Headers({
		cookie: Object.entries(cookies)
			.map(([name, value]) => `${name}=${value}`)
			.join('; '),
		'user-agent': 'vitest'
	});

const baseArgs = (cookies: Record<string, string>, fetch: typeof globalThis.fetch) => ({
	...jar(cookies),
	args: {
		cookies: jar(cookies).cookies,
		requestHeaders: requestHeaders(cookies),
		requestUrl: new URL('https://app.example.com/feed/my-clubs'),
		convexSiteUrl: 'https://site.example.com',
		fetch
	}
});

describe('cookie helpers', () => {
	it('reads either cookie separator and the __Secure- variant', () => {
		expect(readConvexJwtCookie(jar({ 'better-auth.convex_jwt': 'a' }).cookies)).toBe('a');
		expect(readConvexJwtCookie(jar({ '__Secure-better-auth.convex_jwt': 'b' }).cookies)).toBe('b');
		expect(hasSessionCookie(jar({ '__Secure-better-auth.session_token': 's' }).cookies)).toBe(true);
		expect(hasSessionCookie(jar({}).cookies)).toBe(false);
	});

	it('parses a Set-Cookie header into cookies.set arguments', () => {
		expect(
			parseSetCookie(
				'__Secure-better-auth.convex_jwt=x.y.z; Max-Age=900; Path=/; Domain=.example.com; HttpOnly; Secure; SameSite=Lax'
			)
		).toEqual({
			name: '__Secure-better-auth.convex_jwt',
			value: 'x.y.z',
			options: {
				path: '/',
				domain: '.example.com',
				maxAge: 900,
				httpOnly: true,
				secure: true,
				sameSite: 'lax'
			}
		});
		// Never left to SvelteKit's default (Secure everywhere but `localhost`).
		expect(parseSetCookie('better-auth.convex_jwt=a; Path=/')?.options).toEqual({
			path: '/',
			httpOnly: false,
			secure: false
		});
		expect(parseSetCookie('garbage')).toBeNull();
	});
});

describe('resolveConvexToken', () => {
	it('uses the convex_jwt cookie without any request', async () => {
		const fetch = vi.fn<typeof globalThis.fetch>();
		const cookies = jar({ 'better-auth.convex_jwt': 'cached', 'better-auth.session_token': 's' });
		const token = await resolveConvexToken({
			...baseArgs({}, fetch).args,
			cookies: cookies.cookies
		});
		expect(token).toBe('cached');
		expect(fetch).not.toHaveBeenCalled();
	});

	it('does nothing for a visitor without a session cookie', async () => {
		const fetch = vi.fn<typeof globalThis.fetch>();
		expect(await resolveConvexToken(baseArgs({}, fetch).args)).toBeUndefined();
		expect(fetch).not.toHaveBeenCalled();
	});

	// The CL-815 regression: right after a sign-in the session cookie is set but 0.13 has
	// expired convex_jwt, so the token comes from /convex/token and its cookie is kept.
	it('fetches a token with the session cookie when convex_jwt is missing, and keeps its cookie', async () => {
		const fetch = vi.fn<typeof globalThis.fetch>(async () => {
			const headers = new Headers({ 'content-type': 'application/json' });
			headers.append(
				'set-cookie',
				'better-auth.convex_jwt=fresh.jwt.token; Max-Age=900; Path=/; HttpOnly; SameSite=Lax'
			);
			return new Response(JSON.stringify({ token: 'fresh.jwt.token' }), { status: 200, headers });
		});
		const cookies = jar({ 'better-auth.session_token': 'sess' });
		const token = await resolveConvexToken({
			...baseArgs({ 'better-auth.session_token': 'sess' }, fetch).args,
			cookies: cookies.cookies
		});

		expect(token).toBe('fresh.jwt.token');
		const [url, init] = fetch.mock.calls[0];
		expect(String(url)).toBe('https://site.example.com/api/auth/convex/token');
		const headers = new Headers(init?.headers);
		expect(headers.get('cookie')).toBe('better-auth.session_token=sess');
		expect(headers.get('x-better-auth-forwarded-host')).toBe('app.example.com');
		expect(headers.get('x-better-auth-forwarded-proto')).toBe('https');
		expect(cookies.set).toHaveBeenCalledWith('better-auth.convex_jwt', 'fresh.jwt.token', {
			path: '/',
			maxAge: 900,
			httpOnly: true,
			secure: false,
			sameSite: 'lax'
		});
	});

	it('treats a stale session (401) or a network error as signed out', async () => {
		const unauthorized = vi.fn<typeof globalThis.fetch>(
			async () => new Response(null, { status: 401 })
		);
		expect(
			await resolveConvexToken(baseArgs({ 'better-auth.session_token': 'old' }, unauthorized).args)
		).toBeUndefined();
		const failing = vi.fn<typeof globalThis.fetch>(async () => {
			throw new TypeError('fetch failed');
		});
		expect(
			await resolveConvexToken(baseArgs({ 'better-auth.session_token': 'old' }, failing).args)
		).toBeUndefined();
	});
});
