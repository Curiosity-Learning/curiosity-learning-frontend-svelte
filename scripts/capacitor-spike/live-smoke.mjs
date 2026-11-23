#!/usr/bin/env node
// CL-819 spike: the native app's auth path against a REAL deployment, from Node, pretending to be
// the WebView (Origin: capacitor://localhost or https://localhost). Uses the same client code the
// app ships: Better Auth's client + crossDomainClient over the synchronous secure-storage cache.
//
//   SITE=https://<deployment>.convex.site EMAIL=... PASSWORD=... \
//     node scripts/capacitor-spike/live-smoke.mjs [capacitor://localhost|https://localhost]
//
// Never point this at prod. Checks: CORS preflight (native allowed, foreign refused), password
// sign-in, header-carried session, Convex JWT, authenticated Convex WebSocket query, "relaunch"
// from the stored cookie, sign-out and server-side revocation of the old cookie.
import { createAuthClient } from 'better-auth/client';
import { ConvexClient } from 'convex/browser';
import { anyApi } from 'convex/server';
import { convexClient, crossDomainClient } from '@convex-dev/better-auth/client/plugins';
import {
	createMemorySecureStore,
	createSyncStorageCache
} from '../../src/capacitor-spike/lib/secure-storage-cache.ts';

const site = process.env.SITE;
const email = process.env.EMAIL;
const password = process.env.PASSWORD;
const origin = process.argv[2] ?? 'capacitor://localhost';
if (!site || !email || !password) {
	console.error('Set SITE, EMAIL and PASSWORD.');
	process.exit(1);
}

let failures = 0;
const check = (label, ok, detail = '') => {
	if (!ok) failures += 1;
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
};

const preflight = async (from) => {
	const response = await fetch(`${site}/api/auth/sign-in/email`, {
		method: 'OPTIONS',
		headers: {
			origin: from,
			'access-control-request-method': 'POST',
			'access-control-request-headers': 'content-type,better-auth-cookie'
		}
	});
	return response.headers.get('access-control-allow-origin');
};
check(`preflight allows ${origin}`, (await preflight(origin)) === origin);
check('preflight refuses https://evil.example', (await preflight('https://evil.example')) === null);

const keys = ['better-auth_cookie', 'better-auth_session_data'];
const store = createMemorySecureStore();
const makeClient = async () => {
	const storage = createSyncStorageCache(store, keys);
	await storage.hydrate();
	const client = createAuthClient({
		baseURL: site,
		plugins: [convexClient(), crossDomainClient({ storage })],
		fetchOptions: {
			customFetchImpl: (input, init) => {
				const headers = new Headers(init?.headers);
				headers.set('origin', origin);
				return fetch(input, { ...init, headers });
			}
		}
	});
	return { client, storage };
};

const { client, storage } = await makeClient();
const signIn = await client.signIn.email({ email, password });
await storage.flush();
check('password sign-in', !signIn.error, signIn.error?.message ?? '');
check(
	'session cookie stored in the secure store (not a browser cookie)',
	(store.snapshot()['better-auth_cookie'] ?? '').includes('session_token')
);
const session = await client.getSession();
check('get-session over Better-Auth-Cookie', session.data?.user.email === email.toLowerCase());

const token = await client.$fetch('/convex/token', { method: 'GET' });
const jwt = token.data?.token ?? '';
check('Convex JWT issued', jwt.split('.').length === 3);

// The Convex WebSocket, authenticated with that JWT (what the app's ConvexClient does).
const convexUrl = process.env.CONVEX_URL ?? site.replace(/\.convex\.site$/, '.convex.cloud');
const convex = new ConvexClient(convexUrl);
const wsAuthenticated = await new Promise((resolve) => {
	convex.setAuth(
		async () => jwt,
		(isAuthenticated) => resolve(isAuthenticated)
	);
	setTimeout(() => resolve(false), 15_000);
});
check('Convex WebSocket authenticated', wsAuthenticated === true);
const viewer = await convex.query(anyApi.auth.getCurrentUser, {});
check('authenticated query over the WebSocket', viewer?.email === email.toLowerCase());
await convex.close();

const relaunched = await makeClient();
const again = await relaunched.client.getSession();
check(
	'relaunch: new client over the same store is signed in',
	again.data?.user.email === email.toLowerCase()
);

const oldCookie = client.getCookie();
await client.signOut();
await storage.flush();
const replay = await fetch(`${site}/api/auth/get-session`, {
	headers: { origin, 'better-auth-cookie': oldCookie }
});
check('sign-out revoked the session on the server', (await replay.json()) === null);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
