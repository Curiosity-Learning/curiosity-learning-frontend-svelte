// Content-Security-Policy for the website (CL-818). Plain JS with JSDoc types so that
// `svelte.config.js` (loaded by Node, not Vite) can import the same directives the hook extends.
//
// The policy is REPORT-ONLY: browsers log and report violations but never block anything.
// SvelteKit (`kit.csp`, mode 'auto') adds a per-request nonce to `script-src` and sends the
// `Content-Security-Policy-Report-Only` header on every dynamically rendered page. The server
// hook then appends the hosts that come from runtime env (media CDN, S3 public base URL) and the
// Sentry report endpoint, which are not known when `svelte.config.js` is evaluated.

export const CSP_REPORT_ONLY_HEADER = 'content-security-policy-report-only';
export const CSP_REPORTING_GROUP = 'csp-endpoint';

/** @typedef {NonNullable<NonNullable<import('@sveltejs/kit').KitConfig['csp']>['reportOnly']>} CspDirectives */
/** @typedef {CspDirectives['img-src'] extends (infer S)[] | undefined ? S : never} CspSource */

/** @type {CspSource} */
const SENTRY_INGEST_HOST = 'https://o4511563803852800.ingest.de.sentry.io';

/** @type {CspSource[]} */
const CONVEX = ['https://*.convex.cloud', 'wss://*.convex.cloud', 'https://*.convex.site'];
// Media: CloudFront signed URLs on our own domain (assets.curiositylearning.org), plus the S3
// bucket for presigned POST uploads and the public-object fallback (`<bucket>.s3.<region>…`).
/** @type {CspSource[]} */
const MEDIA = [
	'https://*.curiositylearning.org',
	'https://*.amazonaws.com',
	'https://*.cloudfront.net'
];
// Mapbox GL JS: https://docs.mapbox.com/mapbox-gl-js/guides/browsers-and-testing/
/** @type {CspSource[]} */
const MAPBOX = [
	'https://api.mapbox.com',
	'https://events.mapbox.com',
	'https://*.tiles.mapbox.com'
];
/** @type {CspSource[]} */
const GOOGLE_AVATARS = ['https://lh3.googleusercontent.com', 'https://*.googleusercontent.com'];

/** @type {CspDirectives} */
export const cspDirectives = {
	'default-src': ['self'],
	// SvelteKit adds the nonce (or hash) for its own inline bootstrap script.
	'script-src': ['self'],
	// Svelte transitions inject inline <style>; a documented SvelteKit limitation.
	'style-src': ['self', 'unsafe-inline'],
	'img-src': ['self', 'data:', 'blob:', ...MEDIA, ...MAPBOX, ...GOOGLE_AVATARS],
	'media-src': ['self', 'blob:', ...MEDIA],
	'font-src': ['self', 'data:'],
	'connect-src': ['self', ...CONVEX, ...MEDIA, ...MAPBOX, SENTRY_INGEST_HOST],
	// Mapbox GL runs its tile workers from blob: URLs.
	'worker-src': ['self', 'blob:'],
	'child-src': ['self', 'blob:'],
	'frame-src': ['self'],
	'manifest-src': ['self'],
	'object-src': ['none'],
	'base-uri': ['self'],
	// Google sign-in posts to our auth endpoint, which redirects to Google.
	'form-action': ['self', 'https://accounts.google.com'],
	'frame-ancestors': ['none'],
	// SvelteKit rejects a report-only policy without a reporting directive (every page would 500).
	// The hook defines this group in a Reporting-Endpoints header and adds report-uri at runtime.
	'report-to': [CSP_REPORTING_GROUP]
};

/**
 * Origin of an env URL (`https://host[:port]`), or null when unset or not http(s).
 * @param {string | null | undefined} value
 */
export const originFromEnvUrl = (value) => {
	const trimmed = value?.trim();
	if (!trimmed) return null;
	try {
		const url = new URL(trimmed);
		if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
		return url.origin;
	} catch {
		return null;
	}
};

/**
 * Sentry's CSP report endpoint for a DSN: `https://<host>/api/<project>/security/?sentry_key=…`.
 * https://docs.sentry.io/platforms/javascript/guides/sveltekit/security-policy-reporting/
 * @param {string | null | undefined} dsn
 * @param {string | null | undefined} environment
 * @returns {string | null}
 */
export const buildSentryCspReportUri = (dsn, environment) => {
	const trimmed = dsn?.trim();
	if (!trimmed) return null;
	try {
		const url = new URL(trimmed);
		const projectId = url.pathname.split('/').filter(Boolean).pop();
		if (!url.username || !projectId) return null;
		const report = new URL(`${url.protocol}//${url.host}/api/${projectId}/security/`);
		report.searchParams.set('sentry_key', url.username);
		const env = environment?.trim();
		if (env) report.searchParams.set('sentry_environment', env);
		return report.toString();
	} catch {
		return null;
	}
};

/**
 * Adds runtime sources and reporting to a serialized CSP header value.
 * Sources already present in a directive are not duplicated; unknown directives are appended.
 * @param {string} header
 * @param {{ extraSources?: Partial<Record<string, string[]>>, reportUri?: string | null }} options
 */
export const extendCspHeader = (header, { extraSources = {}, reportUri = null }) => {
	/** @type {Map<string, string[]>} */
	const directives = new Map();
	for (const part of header.split(';')) {
		const [name, ...values] = part.trim().split(/\s+/).filter(Boolean);
		if (name) directives.set(name.toLowerCase(), values);
	}

	for (const [name, sources] of Object.entries(extraSources)) {
		if (!sources?.length) continue;
		const current = directives.get(name) ?? [];
		for (const source of sources) {
			if (!current.includes(source)) current.push(source);
		}
		directives.set(name, current);
	}

	if (reportUri) {
		directives.set('report-uri', [reportUri]);
		directives.set('report-to', [CSP_REPORTING_GROUP]);
	}

	return [...directives].map(([name, values]) => [name, ...values].join(' ')).join('; ');
};

/**
 * Runtime additions for the hook: media hosts from env and the Sentry report endpoint.
 * @param {{ mediaCdnBaseUrl?: string | null, mediaS3PublicBaseUrl?: string | null,
 *   sentryDsn?: string | null, sentryEnabled?: boolean, sentryEnvironment?: string | null }} env
 */
export const resolveRuntimeCsp = (env) => {
	const mediaOrigins = [env.mediaCdnBaseUrl, env.mediaS3PublicBaseUrl]
		.map(originFromEnvUrl)
		.filter((origin) => origin !== null);
	return {
		extraSources: {
			'img-src': mediaOrigins,
			'media-src': mediaOrigins,
			'connect-src': mediaOrigins
		},
		reportUri:
			env.sentryEnabled === false
				? null
				: buildSentryCspReportUri(env.sentryDsn, env.sentryEnvironment)
	};
};
