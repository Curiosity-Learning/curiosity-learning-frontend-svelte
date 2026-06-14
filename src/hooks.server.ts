import * as Sentry from '@sentry/sveltekit';
import type { Handle } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { getToken } from '@mmailaender/convex-better-auth-svelte/sveltekit';
import { env as privateEnv } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import { createAuth } from '$convex/auth';
import { redactSentryEvent } from '$lib/monitoring/redaction';

const dsn = publicEnv.PUBLIC_SENTRY_DSN?.trim();

Sentry.init({
	dsn,
	enabled: Boolean(dsn),
	environment:
		privateEnv.SENTRY_ENVIRONMENT?.trim() ||
		privateEnv.VERCEL_ENV?.trim() ||
		privateEnv.NODE_ENV ||
		'development',
	sendDefaultPii: false,
	tracesSampleRate: 0,
	enableLogs: false,
	beforeSend: redactSentryEvent
});

const handleAuthToken: Handle = async ({ event, resolve }) => {
	event.locals.token = await getToken(createAuth, event.cookies);
	return resolve(event);
};

export const handle: Handle = sequence(Sentry.sentryHandle(), handleAuthToken);
export const handleError = Sentry.handleErrorWithSentry();
