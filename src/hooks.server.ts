import * as Sentry from '@sentry/sveltekit';
import type { Handle } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { env as privateEnv } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import { PUBLIC_CONVEX_SITE_URL } from '$env/static/public';
import { resolveConvexToken } from '$lib/server/convex-token';
import { buildSharedSentryOptions } from '$lib/monitoring/sentry-config';
import { logApiRequests } from '$lib/monitoring/api-logging';

Sentry.init(
	buildSharedSentryOptions({
		dsn: publicEnv.PUBLIC_SENTRY_DSN,
		environment:
			privateEnv.SENTRY_ENVIRONMENT?.trim() || privateEnv.VERCEL_ENV?.trim() || privateEnv.NODE_ENV,
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

export const handle: Handle = sequence(Sentry.sentryHandle(), logApiRequests, handleAuthToken);
export const handleError = Sentry.handleErrorWithSentry();
