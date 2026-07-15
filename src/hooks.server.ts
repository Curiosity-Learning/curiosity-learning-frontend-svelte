import * as Sentry from '@sentry/sveltekit';
import type { Handle } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { getToken } from '@mmailaender/convex-better-auth-svelte/sveltekit';
import { env as privateEnv } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import { createAuth } from '$convex/auth';
import { buildSharedSentryOptions } from '$lib/monitoring/sentry-config';
import { logApiRequests } from '$lib/monitoring/api-logging';

Sentry.init(
	buildSharedSentryOptions({
		dsn: publicEnv.PUBLIC_SENTRY_DSN,
		environment:
			privateEnv.SENTRY_ENVIRONMENT?.trim() ||
			privateEnv.VERCEL_ENV?.trim() ||
			privateEnv.NODE_ENV,
		enabledFlag: publicEnv.PUBLIC_SENTRY_ENABLED,
		tracesSampleRate: publicEnv.PUBLIC_SENTRY_TRACES_SAMPLE_RATE,
		profilesSampleRate: publicEnv.PUBLIC_SENTRY_PROFILES_SAMPLE_RATE,
		logsEnabledFlag: publicEnv.PUBLIC_SENTRY_LOGS_ENABLED
	})
);

const handleAuthToken: Handle = async ({ event, resolve }) => {
	event.locals.token = await getToken(createAuth, event.cookies);
	return resolve(event);
};

export const handle: Handle = sequence(Sentry.sentryHandle(), logApiRequests, handleAuthToken);
export const handleError = Sentry.handleErrorWithSentry();
