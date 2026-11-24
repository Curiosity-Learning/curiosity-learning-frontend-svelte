// CL-819 spike: helpers behind the phone harness's readouts. Kept free of Capacitor imports so
// they run in unit tests. Ron screenshots these panels for Fibery, so nothing shown may carry a
// credential.

// Query and fragment keys whose values are credentials or personal data: Better Auth's
// magic-link and one-time tokens, the /auth/link fragment (t = token, as = address), and OAuth
// redirect parameters.
const SENSITIVE_KEYS = new Set([
	't',
	'token',
	'ott',
	'as',
	'email',
	'code',
	'state',
	'nonce',
	'id_token',
	'access_token',
	'refresh_token',
	'authuser',
	'session',
	'session_token'
]);

export const REDACTED = '[redacted]';

const redactParams = (raw: string) => {
	const params = new URLSearchParams(raw);
	let changed = false;
	for (const key of new Set(params.keys())) {
		if (SENSITIVE_KEYS.has(key.toLowerCase())) {
			params.set(key, REDACTED);
			changed = true;
		}
	}
	// URLSearchParams would percent-encode the brackets; keep the marker readable.
	return changed ? params.toString().replaceAll(encodeURIComponent(REDACTED), REDACTED) : raw;
};

/** The URL with every sensitive query and fragment value replaced; non-URLs are hidden whole. */
export const redactUrl = (rawUrl: string): string => {
	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		return REDACTED;
	}
	const search = url.search ? `?${redactParams(url.search.slice(1))}` : '';
	const hash = url.hash ? `#${redactParams(url.hash.slice(1))}` : '';
	return `${url.origin}${url.pathname}${search}${hash}`;
};

/** Same as redactUrl for an app-relative path such as a sign-in link's `next`. */
export const redactPath = (path: string): string => {
	const base = 'https://path.invalid';
	try {
		return redactUrl(new URL(path, base).toString()).slice(base.length);
	} catch {
		return REDACTED;
	}
};

/**
 * Remembers which incoming links were already handled. On a cold start iOS can deliver the same
 * universal link twice, through appUrlOpen and App.getLaunchUrl(); a one-time token or sign-in
 * link must be redeemed only once, or the second try fails and overwrites the PASS.
 */
export const createLinkDeduper = () => {
	const seen = new Set<string>();
	return {
		/** True the first time a URL is offered, false for every repeat. */
		claim(url: string) {
			if (seen.has(url)) return false;
			seen.add(url);
			return true;
		}
	};
};

export type RevocationResult =
	| { status: 'revoked'; detail: string }
	| { status: 'still-live'; detail: string }
	| { status: 'error'; detail: string };

/**
 * Replays an old Better-Auth-Cookie against get-session. Only an HTTP 200 whose body is
 * `null` proves the server revoked the session; anything else (network failure, non-2xx, an
 * unreadable body) is an error, never a PASS.
 */
export const checkRevocation = async (
	siteUrl: string,
	cookie: string,
	fetchImpl: typeof fetch = fetch
): Promise<RevocationResult> => {
	if (!/session_token=[^;]/.test(cookie)) {
		return { status: 'error', detail: 'no session cookie was stored before sign-out' };
	}
	let response: Response;
	try {
		response = await fetchImpl(`${siteUrl}/api/auth/get-session`, {
			credentials: 'omit',
			headers: { 'Better-Auth-Cookie': cookie }
		});
	} catch (error) {
		return {
			status: 'error',
			detail: `request failed: ${error instanceof Error ? error.message : String(error)}`
		};
	}
	if (response.status !== 200) {
		return { status: 'error', detail: `get-session answered HTTP ${response.status}` };
	}
	let body: unknown;
	try {
		body = await response.json();
	} catch {
		return { status: 'error', detail: 'get-session body was not JSON' };
	}
	if (body === null) {
		return { status: 'revoked', detail: 'get-session answered 200 null for the old cookie' };
	}
	const hasSession = typeof body === 'object' && body !== null && 'session' in body;
	return hasSession
		? { status: 'still-live', detail: 'the old cookie still returns a session' }
		: { status: 'error', detail: 'get-session answered 200 with an unexpected body' };
};

/** One line for a storage failure recorded by the secure-storage cache, or null. */
export const describeStorageError = (error: unknown): string | null => {
	if (error === null || error === undefined) return null;
	const message = error instanceof Error ? error.message : String(error);
	return `secure storage error: ${message}`;
};
