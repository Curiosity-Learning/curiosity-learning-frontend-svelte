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
// - "Email a sign-in link to the address that approved" (/child/{id} "not linked", review S9/S4):
//   the parent asked for it on that page and is waiting for it in their other inbox.
export const APPROVING_ACCOUNT_MAGIC_LINK_SECONDS = 30 * 60;

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
	// The address the link signs in, shown on the page so the owner can recognise the account.
	as: string;
};

// "parent@example.com" -> "p…@example.com": enough for the owner to recognise, not enough for
// someone a link was forwarded to to learn the address.
export const maskEmail = (email: string) => {
	const [local, domain] = email.trim().split('@');
	if (!local || !domain) return '…';
	return `${local[0]}…@${domain}`;
};

// The fragment is attacker-controllable (anyone can build /auth/link#t=…&as=…), so `as` is only
// shown when it is shaped like an email address, never as free text on our origin (review
// nice-to-have 4). The address is shown in full (Ron, 2026-11-12): the masked "p…@x.com" made the
// page useless for telling which account a link signs in to, and the link only ever goes to that
// same inbox. Like before, the page text is a hint, not proof: the token decides the account.
// Masked addresses from links sent before this change are still accepted.
const SIGN_IN_ADDRESS_PATTERN = /^[^\s@<>"'…]{1,64}@[^\s@<>"']+\.[^\s@<>"']{2,}$/;
const MASKED_EMAIL_PATTERN = /^[^\s@…]…@[^\s@]{1,253}$/;
export const isDisplayableSignInAddress = (value: string) =>
	value.length <= 254 && (SIGN_IN_ADDRESS_PATTERN.test(value) || MASKED_EMAIL_PATTERN.test(value));

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
		as: isDisplayableSignInAddress(params.get('as') ?? '') ? params.get('as')! : ''
	};
};

// Marker on the page a successful sign-in link lands on (CL-769, review S4): /child/[id] reads
// it once, remembers it for the tab and strips it, and offers "Not your device? Sign out" — a
// link session is the one most likely to be left behind on a shared family computer.
export const SIGNED_IN_VIA_LINK_PARAM = 'via';
export const SIGNED_IN_VIA_LINK_VALUE = 'link';

export const withSignedInViaLinkMarker = (path: string) =>
	`${path}${path.includes('?') ? '&' : '?'}${SIGNED_IN_VIA_LINK_PARAM}=${SIGNED_IN_VIA_LINK_VALUE}`;

// The real verify URL (relative: the interstitial runs on the app origin, whose /api/auth proxy
// reaches Better Auth). Every sign-in link goes through here (minted ones and the plugin's own),
// so this is where the landing page gets the via=link marker; a failed or expired token lands
// on the sign-in page (unmarked `next`), which offers to email a fresh link.
export const buildMagicLinkVerifyPath = (link: { token: string; next: string }) => {
	const params = new URLSearchParams({
		token: link.token,
		callbackURL: toMagicLinkCallbackParam(withSignedInViaLinkMarker(link.next)),
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

// Review S9: the sign-in page offers "Email me a sign-in link" as soon as the typed email
// belongs to an account that can only sign in by link: no password and no Google. Every parent
// account created at consent approval starts like that (childSignup.approveConsent creates the
// user with no `account` rows). Reads auth.getSignupAccountStatusByEmail as is — this adds
// nothing to what that query already tells any caller.
export const isPasswordlessSignInAccount = (status: {
	exists: boolean;
	hasPassword: boolean;
	hasGoogle: boolean;
}) => status.exists && !status.hasPassword && !status.hasGoogle;
