import * as Sentry from '@sentry/sveltekit';
import type { HandleClientError } from '@sveltejs/kit';
import { dev, version } from '$app/environment';
import { env } from '$env/dynamic/public';
import { buildSharedSentryOptions } from '$lib/monitoring/sentry-config';
import {
	isStaleChunkError,
	recoverFromStaleChunkOutsideNavigation,
	reloadOnceForStaleApp,
	wasRecovered
} from '$lib/navigation/stale-app-recovery';

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

const sentryOptions = buildSharedSentryOptions({
	dsn: env.PUBLIC_SENTRY_DSN,
	environment: env.PUBLIC_SENTRY_ENVIRONMENT,
	enabledFlag: env.PUBLIC_SENTRY_ENABLED,
	tracesSampleRate: env.PUBLIC_SENTRY_TRACES_SAMPLE_RATE,
	profilesSampleRate: env.PUBLIC_SENTRY_PROFILES_SAMPLE_RATE,
	logsEnabledFlag: env.PUBLIC_SENTRY_LOGS_ENABLED,
	release: __SENTRY_RELEASE__
});

// Registered before Sentry.init so these run before Sentry's own global handlers: a chunk that
// a deploy removed is recovered here (see stale-app-recovery.ts), and beforeSend then drops it
// (Sentry issue V). Unrecovered ones (reload already tried, offline) are still reported.
window.addEventListener('unhandledrejection', (event) => {
	recoverFromStaleChunkOutsideNavigation(event.reason, version);
});
window.addEventListener('vite:preloadError', (event) => {
	recoverFromStaleChunkOutsideNavigation(event.payload, version);
});

Sentry.init({
	...sentryOptions,
	beforeSend: (event, hint) =>
		wasRecovered(hint.originalException) ? null : sentryOptions.beforeSend(event)
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

const reportError = Sentry.handleErrorWithSentry<HandleClientError>();

export const handleError: HandleClientError = (input) => {
	// A client navigation or hydration needed a chunk from an older deploy (Sentry issue T).
	// Load the target URL as a full page, once per app version so it cannot loop. If that
	// reload already happened (or we are offline), report the error as usual.
	if (isStaleChunkError(input.error) && reloadOnceForStaleApp(input.event.url, version)) {
		return { message: 'Loading the latest version of the app' };
	}
	return reportError(input);
};
