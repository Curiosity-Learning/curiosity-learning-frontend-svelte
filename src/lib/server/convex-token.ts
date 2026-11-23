// Resolves the Convex JWT for an SSR request (CL-815).
//
// The Convex JWT normally rides along in the `convex_jwt` cookie. @convex-dev/better-auth 0.13
// EXPIRES that cookie on every request that starts a session (sign-in, sign-up, OAuth callback,
// magic-link verify, ...) and only sets it again on /convex/token or /get-session. The browser
// calls those after the app has booted, so the FIRST server-rendered page after a sign-in (the
// sign-in redirect, a magic-link landing page) would see a session but no JWT, and every
// protected (app) route would bounce to the sign-in page.
//
// So when the cookie is missing but a Better Auth session cookie is present, ask the Convex
// site's /convex/token endpoint for a JWT with the visitor's own cookies (exactly what the
// browser would do through the /api/auth proxy), and copy the `convex_jwt` cookie it sets onto
// our response so the following requests read it directly again.
//
// No SvelteKit imports: the caller passes the env-derived URL and `fetch` (unit-testable).

const DEFAULT_COOKIE_PREFIX = 'better-auth';
const JWT_COOKIE_SUFFIX = 'convex_jwt';
const SESSION_COOKIE_SUFFIX = 'session_token';

type CookieOptions = {
	path: string;
	domain?: string;
	maxAge?: number;
	httpOnly?: boolean;
	secure?: boolean;
	sameSite?: 'lax' | 'strict' | 'none';
};

export type TokenCookies = {
	get(name: string): string | undefined;
	set(name: string, value: string, options: CookieOptions): void;
};

// Better Auth's cookie names, in the order its getSessionCookie() checks them: `.` before `-`
// as separator, the `__Secure-` variant before the plain one.
const cookieNames = (suffix: string, prefix = DEFAULT_COOKIE_PREFIX) =>
	['.', '-'].flatMap((separator) => {
		const name = `${prefix}${separator}${suffix}`;
		return [`__Secure-${name}`, name];
	});

const firstCookie = (cookies: Pick<TokenCookies, 'get'>, names: string[]) => {
	for (const name of names) {
		const value = cookies.get(name);
		if (value) return value;
	}
	return undefined;
};

export const readConvexJwtCookie = (cookies: Pick<TokenCookies, 'get'>) =>
	firstCookie(cookies, cookieNames(JWT_COOKIE_SUFFIX));

export const hasSessionCookie = (cookies: Pick<TokenCookies, 'get'>) =>
	Boolean(firstCookie(cookies, cookieNames(SESSION_COOKIE_SUFFIX)));

// Parses one Set-Cookie header into SvelteKit's cookies.set() arguments.
export const parseSetCookie = (header: string) => {
	const [pair, ...attributes] = header.split(';');
	const separator = pair.indexOf('=');
	if (separator <= 0) return null;
	const name = pair.slice(0, separator).trim();
	const rawValue = pair.slice(separator + 1).trim();
	let value = rawValue;
	try {
		value = decodeURIComponent(rawValue);
	} catch {
		// keep the raw value
	}
	// `secure` and `httpOnly` are always explicit: SvelteKit's cookies.set() otherwise defaults
	// `secure` to true on any host but exactly `localhost` (e.g. http://<worktree>.localhost),
	// and the copy must carry the attributes Better Auth chose, no more.
	const options: CookieOptions = { path: '/', httpOnly: false, secure: false };
	for (const attribute of attributes) {
		const [rawKey, ...rest] = attribute.split('=');
		const key = rawKey.trim().toLowerCase();
		const attributeValue = rest.join('=').trim();
		if (key === 'path' && attributeValue) options.path = attributeValue;
		else if (key === 'domain' && attributeValue) options.domain = attributeValue;
		else if (key === 'max-age' && /^-?\d+$/.test(attributeValue))
			options.maxAge = Number(attributeValue);
		else if (key === 'httponly') options.httpOnly = true;
		else if (key === 'secure') options.secure = true;
		else if (key === 'samesite') {
			const sameSite = attributeValue.toLowerCase();
			if (sameSite === 'lax' || sameSite === 'strict' || sameSite === 'none') {
				options.sameSite = sameSite;
			}
		}
	}
	return { name, value, options };
};

export const resolveConvexToken = async (args: {
	cookies: TokenCookies;
	// Original request headers (cookie, user-agent, ...) and URL of the SSR request.
	requestHeaders: Headers;
	requestUrl: URL;
	// `https://<deployment>.convex.site`
	convexSiteUrl: string;
	fetch: typeof globalThis.fetch;
}): Promise<string | undefined> => {
	const fromCookie = readConvexJwtCookie(args.cookies);
	if (fromCookie) return fromCookie;
	if (!hasSessionCookie(args.cookies)) return undefined;
	const cookieHeader = args.requestHeaders.get('cookie');
	if (!cookieHeader) return undefined;

	const tokenUrl = new URL('/api/auth/convex/token', args.convexSiteUrl);
	const protocol = args.requestUrl.protocol.replace(/:$/, '');
	// Same forwarding as the /api/auth proxy (@mmailaender/convex-better-auth-svelte): the
	// component reads the public origin from x-better-auth-forwarded-*, so cookie attributes
	// (Secure, __Secure- names) match what the browser gets through the proxy.
	const headers = new Headers({
		accept: 'application/json',
		cookie: cookieHeader,
		origin: args.requestUrl.origin,
		'x-forwarded-proto': protocol,
		'x-better-auth-forwarded-host': args.requestUrl.host,
		'x-better-auth-forwarded-proto': protocol
	});
	const userAgent = args.requestHeaders.get('user-agent');
	if (userAgent) headers.set('user-agent', userAgent);

	let response: Response;
	try {
		response = await args.fetch(tokenUrl, { method: 'GET', headers, redirect: 'manual' });
	} catch {
		return undefined;
	}
	// 401: the session cookie is stale (expired, revoked or signed out elsewhere).
	if (!response.ok) return undefined;
	let token: unknown;
	try {
		token = ((await response.json()) as { token?: unknown }).token;
	} catch {
		return undefined;
	}
	if (typeof token !== 'string' || !token) return undefined;

	for (const header of response.headers.getSetCookie()) {
		const parsed = parseSetCookie(header);
		if (!parsed || !parsed.name.endsWith(JWT_COOKIE_SUFFIX) || !parsed.value) continue;
		args.cookies.set(parsed.name, parsed.value, parsed.options);
	}
	return token;
};
