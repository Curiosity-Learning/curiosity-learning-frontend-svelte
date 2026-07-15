import { describe, expect, it } from 'vitest';
import {
	buildSharedSentryOptions,
	parseBooleanEnv,
	parseSampleRate,
	resolveSentryEnabled
} from './sentry-config';

describe('parseSampleRate', () => {
	it('parses a valid rate in range', () => {
		expect(parseSampleRate('0.5', 0)).toBe(0.5);
	});

	it('falls back on missing, non-numeric, or out-of-range values', () => {
		expect(parseSampleRate(undefined, 0.1)).toBe(0.1);
		expect(parseSampleRate('', 0.1)).toBe(0.1);
		expect(parseSampleRate('not-a-number', 0.1)).toBe(0.1);
		expect(parseSampleRate('1.5', 0.1)).toBe(0.1);
		expect(parseSampleRate('-0.1', 0.1)).toBe(0.1);
	});
});

describe('parseBooleanEnv', () => {
	it('parses true/false and 1/0', () => {
		expect(parseBooleanEnv('true', false)).toBe(true);
		expect(parseBooleanEnv('1', false)).toBe(true);
		expect(parseBooleanEnv('false', true)).toBe(false);
		expect(parseBooleanEnv('0', true)).toBe(false);
	});

	it('falls back on missing or unrecognized values', () => {
		expect(parseBooleanEnv(undefined, true)).toBe(true);
		expect(parseBooleanEnv('', true)).toBe(true);
		expect(parseBooleanEnv('maybe', false)).toBe(false);
	});
});

describe('resolveSentryEnabled', () => {
	it('is disabled without a DSN regardless of the enabled flag', () => {
		expect(resolveSentryEnabled({ dsn: undefined, enabledFlag: 'true' })).toBe(false);
		expect(resolveSentryEnabled({ dsn: '  ', enabledFlag: 'true' })).toBe(false);
	});

	it('defaults to enabled when a DSN is present', () => {
		expect(resolveSentryEnabled({ dsn: 'https://key@sentry.io/1' })).toBe(true);
	});

	it('respects an explicit disabled flag', () => {
		expect(resolveSentryEnabled({ dsn: 'https://key@sentry.io/1', enabledFlag: 'false' })).toBe(
			false
		);
	});
});

describe('buildSharedSentryOptions', () => {
	it('disables everything when there is no DSN', () => {
		const options = buildSharedSentryOptions({});

		expect(options.dsn).toBeUndefined();
		expect(options.enabled).toBe(false);
		expect(options.tracesSampleRate).toBe(0);
		expect(options.enableLogs).toBe(false);
	});

	it('reads sample rates and the logs flag from env when enabled', () => {
		const options = buildSharedSentryOptions({
			dsn: 'https://key@sentry.io/1',
			enabledFlag: 'true',
			tracesSampleRate: '0.25',
			profilesSampleRate: '0.1',
			logsEnabledFlag: 'true'
		});

		expect(options.enabled).toBe(true);
		expect(options.tracesSampleRate).toBe(0.25);
		expect(options.profilesSampleRate).toBe(0.1);
		expect(options.enableLogs).toBe(true);
	});

	it('never enables session replay, regardless of input', () => {
		const options = buildSharedSentryOptions({
			dsn: 'https://key@sentry.io/1',
			enabledFlag: 'true'
		});

		expect(options.replaysSessionSampleRate).toBe(0);
		expect(options.replaysOnErrorSampleRate).toBe(0);
	});

	it('never sends default PII', () => {
		const options = buildSharedSentryOptions({ dsn: 'https://key@sentry.io/1' });

		expect(options.sendDefaultPii).toBe(false);
	});

	it('keeps tracing and logs off when enabled but the env values are missing, instead of guessing a default', () => {
		const options = buildSharedSentryOptions({
			dsn: 'https://key@sentry.io/1',
			enabledFlag: 'true'
		});

		expect(options.enabled).toBe(true);
		expect(options.tracesSampleRate).toBe(0);
		expect(options.profilesSampleRate).toBe(0);
		expect(options.enableLogs).toBe(false);
	});

	it('falls back to "development" for environment only when the env value is missing', () => {
		expect(buildSharedSentryOptions({ dsn: 'https://key@sentry.io/1' }).environment).toBe(
			'development'
		);
		expect(
			buildSharedSentryOptions({ dsn: 'https://key@sentry.io/1', environment: 'staging' })
				.environment
		).toBe('staging');
	});

	it('redacts errors, transactions, logs, and breadcrumbs before sending', () => {
		const options = buildSharedSentryOptions({ dsn: 'https://key@sentry.io/1' });

		expect(typeof options.beforeSend).toBe('function');
		expect(typeof options.beforeSendTransaction).toBe('function');
		expect(typeof options.beforeSendLog).toBe('function');
		expect(typeof options.beforeBreadcrumb).toBe('function');
	});
});
