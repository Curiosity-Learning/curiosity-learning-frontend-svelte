// Shared between the Convex backend (convex/magicLinks.ts mints sign-in links for parents) and
// the sign-in page (the expired-link fallback). Pure functions only: Convex imports this file
// relatively, so it must not pull in SvelteKit modules.

// One lifetime for every magic link: the ones Convex mints into parent emails and the ones the
// Better Auth plugin issues itself (auth.ts passes this as the plugin's `expiresIn`).
export const MAGIC_LINK_EXPIRES_IN_SECONDS = 7 * 24 * 60 * 60;

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
