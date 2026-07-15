import * as Sentry from '@sentry/sveltekit';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/public';
import { buildSharedSentryOptions } from '$lib/monitoring/sentry-config';

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

Sentry.init(
	buildSharedSentryOptions({
		dsn: env.PUBLIC_SENTRY_DSN,
		environment: env.PUBLIC_SENTRY_ENVIRONMENT,
		enabledFlag: env.PUBLIC_SENTRY_ENABLED,
		tracesSampleRate: env.PUBLIC_SENTRY_TRACES_SAMPLE_RATE,
		profilesSampleRate: env.PUBLIC_SENTRY_PROFILES_SAMPLE_RATE,
		logsEnabledFlag: env.PUBLIC_SENTRY_LOGS_ENABLED
	})
);

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
