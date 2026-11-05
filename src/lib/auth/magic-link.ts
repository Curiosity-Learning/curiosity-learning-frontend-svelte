// Shared between the Convex backend (convex/magicLinks.ts mints sign-in links for parents) and
// the sign-in page (the expired-link fallback). Pure functions only: Convex imports this file
// relatively, so it must not pull in SvelteKit modules.

// How long a sign-in link stays usable, per use (review S3). magicLinks.mintMagicLink takes the
// lifetime explicitly; the plugin's own links use SELF_SERVICE (auth.ts `expiresIn`). A link IS a
// session for whoever holds it, so each lifetime is as short as its use allows — an expired link
// costs one click on the sign-in page's "Send me a new link".
// - Consent success screen: shown on screen right after approval, used within minutes or never
//   (the emails cover a parent who closes the tab).
export const CONSENT_SCREEN_MAGIC_LINK_SECONDS = 30 * 60;
// - Notification / chat email buttons: parents read email hours later, not within minutes; two
//   days keeps an evening-or-next-day click working without leaving week-old sessions in inboxes.
export const EMAIL_MAGIC_LINK_SECONDS = 48 * 60 * 60;
// - "Send me a new link" from the sign-in page: the user asked for it and is waiting for it.
export const SELF_SERVICE_MAGIC_LINK_SECONDS = 30 * 60;

// Better Auth's default basePath. auth.ts does not override it and the SvelteKit app proxies
// /api/auth/* to the Convex site (src/routes/api/auth/[...all]).
export const AUTH_BASE_PATH = '/api/auth';

// Emails and the consent screen never link to the verify endpoint directly (review S1): link
// scanners (Safe Links, Mimecast, ...) GET every link on delivery, which would consume the token
// and hand THEM the session. They link to this app page instead, with the token in the URL
// fragment — never sent to a server, so it stays out of request logs, proxies and Referer — and
// the page only calls the verify endpoint when a person presses its button.
export const MAGIC_LINK_INTERSTITIAL_PATH = '/auth/link';

export type MagicLinkInterstitial = {
	token: string;
	// App path to continue to once signed in.
	next: string;
	// Masked address the link signs in, shown as "Sign in as p…@x.com?".
	as: string;
};

// "parent@example.com" -> "p…@example.com": enough for the owner to recognise, not enough for
// someone a link was forwarded to to learn the address.
export const maskEmail = (email: string) => {
	const [local, domain] = email.trim().split('@');
	if (!local || !domain) return '…';
	return `${local[0]}…@${domain}`;
};

export const buildMagicLinkInterstitialFragment = (link: MagicLinkInterstitial) =>
	new URLSearchParams({ t: link.token, next: link.next, as: link.as }).toString();

// Reads the fragment back. A `next` the verify endpoint would reject (see
// isMagicLinkCallbackPath) falls back to home rather than failing the whole sign-in.
export const parseMagicLinkInterstitialFragment = (hash: string): MagicLinkInterstitial | null => {
	const params = new URLSearchParams(hash.replace(/^#/, ''));
	const token = params.get('t');
	if (!token || !/^[a-zA-Z0-9_-]+$/.test(token)) return null;
	const next = params.get('next') ?? '/';
	return {
		token,
		next: isMagicLinkCallbackPath(next) ? next : '/',
		as: params.get('as') ?? ''
	};
};

// The real verify URL (relative: the interstitial runs on the app origin, whose /api/auth proxy
// reaches Better Auth). A failed or expired token lands on the sign-in page, which offers to
// email a fresh link and then continues to `next`.
export const buildMagicLinkVerifyPath = (link: { token: string; next: string }) => {
	const params = new URLSearchParams({
		token: link.token,
		callbackURL: toMagicLinkCallbackParam(link.next),
		errorCallbackURL: toMagicLinkCallbackParam(buildMagicLinkErrorPath(link.next))
	});
	return `${AUTH_BASE_PATH}/magic-link/verify?${params.toString()}`;
};

// Marker the minted links put on their errorCallbackURL, so the sign-in page can tell "your
// sign-in link failed" apart from a Google OAuth error (both arrive as `?error=`).
export const MAGIC_LINK_FAILED_PARAM = 'link';
export const MAGIC_LINK_FAILED_VALUE = 'expired';

// The codes Better Auth's magic-link verify endpoint appends as `?error=` when it redirects to
// errorCallbackURL (better-auth/dist/plugins/magic-link/index.mjs, redirectWithError). Handled
// even without our marker param, e.g. for a link whose errorCallbackURL fell back to callbackURL.
const MAGIC_LINK_ERROR_CODES = new Set([
	'INVALID_TOKEN',
	'EXPIRED_TOKEN',
	'new_user_signup_disabled',
	'failed_to_create_session'
]);

export const isMagicLinkFailure = (params: URLSearchParams) =>
	params.get(MAGIC_LINK_FAILED_PARAM) === MAGIC_LINK_FAILED_VALUE ||
	MAGIC_LINK_ERROR_CODES.has(params.get('error') ?? '');

// Better Auth only accepts relative callback URLs that match this pattern (copied from
// better-auth/dist/auth/trusted-origins.mjs, matchesOriginPattern with allowRelativePaths):
// anything else is rejected with 403 before the link is even checked.
const RELATIVE_CALLBACK_PATTERN = /^\/(?!\/|\\|%2f|%5c)[\w\-.+/@]*(?:\?[\w\-.+/=&%@]*)?$/;

export const isMagicLinkCallbackPath = (path: string) => RELATIVE_CALLBACK_PATTERN.test(path);

// The verify endpoint runs decodeURIComponent() over callbackURL/errorCallbackURL (on top of
// normal query-string decoding) both before validating them against the pattern above and
// before redirecting. Escaping every '%' as '%25' makes that extra decode return exactly the
// path we meant — without it, the encoded `next` in the error path would decode to a second '?',
// fail the pattern, and turn every click (valid token or not) into a 403.
export const toMagicLinkCallbackParam = (path: string) => path.replaceAll('%', '%25');

// Where a failed link lands: the sign-in page, which offers to email a fresh link and then
// continues to `next`.
export const buildMagicLinkErrorPath = (next: string) =>
	`/auth/sign-in?next=${encodeURIComponent(next)}&${MAGIC_LINK_FAILED_PARAM}=${MAGIC_LINK_FAILED_VALUE}`;
