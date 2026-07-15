import { redactSentryBreadcrumb, redactSentryEvent } from './redaction';

export type SentryRuntimeEnv = {
	dsn?: string | null;
	environment?: string | null;
	enabledFlag?: string | null;
	tracesSampleRate?: string | null;
	profilesSampleRate?: string | null;
	logsEnabledFlag?: string | null;
};

export const parseSampleRate = (value: string | null | undefined, fallback: number) => {
	if (!value?.trim()) return fallback;
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) return fallback;
	return parsed;
};

export const parseBooleanEnv = (value: string | null | undefined, fallback: boolean) => {
	if (value === undefined || value === null || value === '') return fallback;
	const normalized = value.trim().toLowerCase();
	if (normalized === 'true' || normalized === '1') return true;
	if (normalized === 'false' || normalized === '0') return false;
	return fallback;
};

export const resolveSentryEnabled = (env: SentryRuntimeEnv) => {
	const dsn = env.dsn?.trim();
	if (!dsn) return false;
	return parseBooleanEnv(env.enabledFlag, true);
};

/**
 * Shared GDPR-safe Sentry options for browser and Node runtimes.
 *
 * Every value that has an env key (dsn, environment, enabled, sample rates,
 * logs) comes straight from env with no dev/prod-branching fallback — if a
 * value is missing or invalid, the corresponding feature is simply off
 * (0 / false) rather than silently guessing a default. sendDefaultPii and
 * the replay sample rates have no env key: they are a fixed GDPR floor
 * (never send PII, never record session replay) that env cannot override.
 */
export const buildSharedSentryOptions = (env: SentryRuntimeEnv) => {
	const dsn = env.dsn?.trim();
	const enabled = resolveSentryEnabled(env);

	return {
		dsn,
		enabled,
		environment: env.environment?.trim() || 'production',
		// EU / GDPR: never send email, IP, cookies, or other default PII.
		sendDefaultPii: false,
		tracesSampleRate: parseSampleRate(env.tracesSampleRate, 0),
		profilesSampleRate: parseSampleRate(env.profilesSampleRate, 0),
		enableLogs: parseBooleanEnv(env.logsEnabledFlag, false),
		beforeSend: redactSentryEvent,
		beforeBreadcrumb: redactSentryBreadcrumb,
		// Session replay stays disabled (sample rate 0) — high GDPR risk for a learning platform.
		replaysSessionSampleRate: 0,
		replaysOnErrorSampleRate: 0
	} as const;
};