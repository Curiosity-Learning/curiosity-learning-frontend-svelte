import * as Sentry from '@sentry/sveltekit';
import type { Handle } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { env as privateEnv } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import { PUBLIC_CONVEX_SITE_URL } from '$env/static/public';
import { resolveConvexToken } from '$lib/server/convex-token';
import { buildSharedSentryOptions } from '$lib/monitoring/sentry-config';
import { logApiRequests } from '$lib/monitoring/api-logging';
import { resolveSentryEnabled } from '$lib/monitoring/sentry-config';
import { resolveRuntimeCsp } from '$lib/security/csp';
import { createCspHandle } from '$lib/security/csp-handle';

const sentryEnvironment =
	privateEnv.SENTRY_ENVIRONMENT?.trim() || privateEnv.VERCEL_ENV?.trim() || privateEnv.NODE_ENV;

Sentry.init(
	buildSharedSentryOptions({
		dsn: publicEnv.PUBLIC_SENTRY_DSN,
		environment: sentryEnvironment,
		enabledFlag: publicEnv.PUBLIC_SENTRY_ENABLED,
		tracesSampleRate: publicEnv.PUBLIC_SENTRY_TRACES_SAMPLE_RATE,
		profilesSampleRate: publicEnv.PUBLIC_SENTRY_PROFILES_SAMPLE_RATE,
		logsEnabledFlag: publicEnv.PUBLIC_SENTRY_LOGS_ENABLED
	})
);

const handleAuthToken: Handle = async ({ event, resolve }) => {
	// The auth proxy itself needs no Convex token (and must not fetch one per request).
	if (event.url.pathname.startsWith('/api/auth/')) return resolve(event);
	// From the convex_jwt cookie; right after a sign-in (when @convex-dev/better-auth 0.13 has
	// expired that cookie) from /convex/token with the visitor's session cookie — see
	// lib/server/convex-token.ts (CL-815).
	event.locals.token = await resolveConvexToken({
		cookies: event.cookies,
		requestHeaders: event.request.headers,
		requestUrl: event.url,
		convexSiteUrl: PUBLIC_CONVEX_SITE_URL,
		fetch: globalThis.fetch
	});
	return resolve(event);
};

// SvelteKit emits the report-only CSP (kit.csp in svelte.config.js) on rendered pages; add the
// hosts that only runtime env knows and point reports at Sentry. See src/lib/security/csp.js.
const runtimeCsp = resolveRuntimeCsp({
	mediaCdnBaseUrl: privateEnv.MEDIA_CDN_BASE_URL,
	mediaS3PublicBaseUrl: privateEnv.MEDIA_S3_PUBLIC_BASE_URL,
	sentryDsn: publicEnv.PUBLIC_SENTRY_DSN,
	sentryEnabled: resolveSentryEnabled({
		dsn: publicEnv.PUBLIC_SENTRY_DSN,
		enabledFlag: publicEnv.PUBLIC_SENTRY_ENABLED
	}),
	sentryEnvironment: sentryEnvironment || 'development'
});

const handleCsp = createCspHandle(runtimeCsp);

export const handle: Handle = sequence(
	Sentry.sentryHandle(),
	logApiRequests,
	handleCsp,
	handleAuthToken
);
export const handleError = Sentry.handleErrorWithSentry();
