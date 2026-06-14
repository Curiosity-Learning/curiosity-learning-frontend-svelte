import * as Sentry from '@sentry/sveltekit';
import { env } from '$env/dynamic/public';
import { redactSentryEvent } from '$lib/monitoring/redaction';

const dsn = env.PUBLIC_SENTRY_DSN?.trim();

Sentry.init({
	dsn,
	enabled: Boolean(dsn),
	environment: env.PUBLIC_SENTRY_ENVIRONMENT?.trim() || 'development',
	sendDefaultPii: false,
	tracesSampleRate: 0,
	enableLogs: false,
	beforeSend: redactSentryEvent
});

export const handleError = Sentry.handleErrorWithSentry();
