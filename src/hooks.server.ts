import * as Sentry from '@sentry/sveltekit';
import type { Handle } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { getToken } from '@mmailaender/convex-better-auth-svelte/sveltekit';
import { createAuth } from '$convex/auth';
import { redactSentryEvent } from '$lib/monitoring/redaction';

const dsn = process.env.PUBLIC_SENTRY_DSN?.trim();

Sentry.init({
	dsn,
	enabled: Boolean(dsn),
	environment:
		process.env.SENTRY_ENVIRONMENT?.trim() ||
		process.env.VERCEL_ENV?.trim() ||
		process.env.NODE_ENV ||
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
