import * as Sentry from '@sentry/sveltekit';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/public';
import { redactSentryEvent } from '$lib/monitoring/redaction';

const dsn = env.PUBLIC_SENTRY_DSN?.trim();

type SentryDevTestResult = {
	eventId: string;
	flushed: boolean;
	initialized: boolean;
	enabled: boolean;
	environment: string | undefined;
	hasDsn: boolean;
};

declare global {
	interface Window {
		__curiositySentryDevTest?: (message?: string) => Promise<SentryDevTestResult>;
	}
}

Sentry.init({
	dsn,
	enabled: Boolean(dsn),
	environment: env.PUBLIC_SENTRY_ENVIRONMENT?.trim() || 'development',
	sendDefaultPii: false,
	tracesSampleRate: 0,
	enableLogs: false,
	beforeSend: redactSentryEvent
});

if (dev) {
	Object.defineProperty(window, '__curiositySentryDevTest', {
		configurable: true,
		value: async (
			message = 'Controlled Sentry development verification'
		): Promise<SentryDevTestResult> => {
			const eventId = Sentry.captureException(new Error(message));
			const flushed = await Sentry.flush(3000);
			const options = Sentry.getClient()?.getOptions();

			return {
				eventId,
				flushed,
				initialized: Sentry.isInitialized(),
				enabled: Sentry.isEnabled(),
				environment: options?.environment,
				hasDsn: Boolean(options?.dsn)
			};
		}
	});
}

export const handleError = Sentry.handleErrorWithSentry();
