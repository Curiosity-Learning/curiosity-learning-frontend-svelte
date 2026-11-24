// CL-819 spike: what an incoming universal link (App 'appUrlOpen') asks the app to do.
//
// Two shapes can arrive on the app's link domain (the web app's origin, BETTER_AUTH_URL):
// - `...?ott=<token>`: the crossDomain plugin's one-time token, appended when a magic-link verify
//   or OAuth callback redirected to an exact trusted https origin. Swapped for the session with
//   POST /cross-domain/one-time-token/verify.
// - `/auth/link#t=<token>&next=...`: the emailed sign-in link's interstitial (CL-768/769). The
//   app verifies the magic-link token itself, without a callbackURL, so Better Auth answers with
//   JSON (and a Set-Better-Auth-Cookie header) instead of redirecting.

import { parseMagicLinkInterstitialFragment } from '../../lib/auth/magic-link';

export type IncomingLink =
	| { kind: 'one-time-token'; token: string; url: string }
	| { kind: 'magic-link'; token: string; next: string; url: string }
	| { kind: 'ignored'; reason: string; url: string };

export const parseIncomingLink = (rawUrl: string, allowedOrigin: string | null): IncomingLink => {
	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		return { kind: 'ignored', reason: 'not a URL', url: rawUrl };
	}
	// Universal links only arrive for domains listed in the app's associated domains, but a custom
	// scheme or a stray domain must not be able to hand the app a token to redeem.
	if (!allowedOrigin || url.origin !== new URL(allowedOrigin).origin) {
		return {
			kind: 'ignored',
			reason: `origin ${url.origin} is not the app link origin`,
			url: rawUrl
		};
	}
	const ott = url.searchParams.get('ott');
	if (ott && /^[A-Za-z0-9_-]{16,128}$/.test(ott)) {
		return { kind: 'one-time-token', token: ott, url: rawUrl };
	}
	if (url.pathname === '/auth/link') {
		const parsed = parseMagicLinkInterstitialFragment(url.hash);
		if (parsed) return { kind: 'magic-link', token: parsed.token, next: parsed.next, url: rawUrl };
		return { kind: 'ignored', reason: 'sign-in link without a token', url: rawUrl };
	}
	return { kind: 'ignored', reason: 'no token in link', url: rawUrl };
};
