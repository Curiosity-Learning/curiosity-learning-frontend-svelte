import { describe, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import config from '../../../svelte.config.js';
import {
	CSP_REPORT_ONLY_HEADER,
	buildSentryCspReportUri,
	cspDirectives,
	extendCspHeader,
	originFromEnvUrl,
	resolveRuntimeCsp
} from './csp';
import { createCspHandle } from './csp-handle';

const DSN =
	'https://d01f876073a72f8b3d36d41a8372e2c8@o4511563803852800.ingest.de.sentry.io/4511563814207568';

describe('svelte.config.js csp', () => {
	it('is report-only and never enforcing', () => {
		const csp = config.kit?.csp;
		expect(csp?.mode).toBe('auto');
		expect(csp?.reportOnly).toBe(cspDirectives);
		expect(csp?.directives).toBeUndefined();
	});
});

describe('cspDirectives', () => {
	it('locks down plugins, base and framing', () => {
		expect(cspDirectives['object-src']).toEqual(['none']);
		expect(cspDirectives['base-uri']).toEqual(['self']);
		expect(cspDirectives['frame-ancestors']).toEqual(['none']);
		expect(cspDirectives['script-src']).toEqual(['self']);
		// Required by SvelteKit for report-only mode.
		expect(cspDirectives['report-to']).toEqual(['csp-endpoint']);
	});

	it('allows the origins the app uses', () => {
		expect(cspDirectives['connect-src']).toEqual(
			expect.arrayContaining([
				'https://*.convex.cloud',
				'wss://*.convex.cloud',
				'https://*.convex.site',
				'https://api.mapbox.com',
				'https://events.mapbox.com',
				'https://*.amazonaws.com',
				'https://o4511563803852800.ingest.de.sentry.io'
			])
		);
		expect(cspDirectives['img-src']).toEqual(
			expect.arrayContaining(['data:', 'blob:', 'https://lh3.googleusercontent.com'])
		);
		expect(cspDirectives['worker-src']).toContain('blob:');
		expect(cspDirectives['style-src']).toContain('unsafe-inline');
		expect(cspDirectives['form-action']).toContain('https://accounts.google.com');
	});

	it('does not allow iconify (the Google icon is bundled)', () => {
		expect(JSON.stringify(cspDirectives)).not.toContain('iconify');
	});
});

describe('originFromEnvUrl', () => {
	it('returns the origin of http(s) URLs only', () => {
		expect(originFromEnvUrl(' https://assets.example.org/media/ ')).toBe(
			'https://assets.example.org'
		);
		expect(originFromEnvUrl('ftp://x.example.org')).toBeNull();
		expect(originFromEnvUrl('not a url')).toBeNull();
		expect(originFromEnvUrl('')).toBeNull();
		expect(originFromEnvUrl(undefined)).toBeNull();
	});
});

describe('buildSentryCspReportUri', () => {
	it('builds the Sentry security endpoint from the DSN', () => {
		expect(buildSentryCspReportUri(DSN, 'preview')).toBe(
			'https://o4511563803852800.ingest.de.sentry.io/api/4511563814207568/security/?sentry_key=d01f876073a72f8b3d36d41a8372e2c8&sentry_environment=preview'
		);
	});

	it('returns null for a missing or malformed DSN', () => {
		expect(buildSentryCspReportUri('', 'x')).toBeNull();
		expect(buildSentryCspReportUri('https://host.example/1', 'x')).toBeNull();
		expect(buildSentryCspReportUri('garbage', 'x')).toBeNull();
	});
});

describe('extendCspHeader', () => {
	const base = "default-src 'self'; img-src 'self' data:; connect-src 'self'";

	it('appends sources without duplicates and adds reporting', () => {
		const result = extendCspHeader(base, {
			extraSources: {
				'img-src': ['https://cdn.example.org', 'data:'],
				'media-src': ['https://cdn.example.org']
			},
			reportUri: 'https://report.example/csp'
		});
		expect(result).toBe(
			"default-src 'self'; img-src 'self' data: https://cdn.example.org; connect-src 'self'; media-src https://cdn.example.org; report-uri https://report.example/csp; report-to csp-endpoint"
		);
	});

	it('leaves the header unchanged with nothing to add', () => {
		expect(extendCspHeader(base, {})).toBe(base);
	});
});

describe('resolveRuntimeCsp', () => {
	it('adds env media origins and the report endpoint', () => {
		const runtime = resolveRuntimeCsp({
			mediaCdnBaseUrl: 'https://assets.example.org',
			mediaS3PublicBaseUrl: 'https://bucket.s3.eu-central-1.amazonaws.com/public',
			sentryDsn: DSN,
			sentryEnabled: true,
			sentryEnvironment: 'production'
		});
		expect(runtime.extraSources['img-src']).toEqual([
			'https://assets.example.org',
			'https://bucket.s3.eu-central-1.amazonaws.com'
		]);
		expect(runtime.reportUri).toContain('sentry_environment=production');
	});

	it('sends no reports when Sentry is disabled', () => {
		expect(
			resolveRuntimeCsp({ sentryDsn: DSN, sentryEnabled: false, sentryEnvironment: 'x' }).reportUri
		).toBeNull();
	});
});

describe('createCspHandle', () => {
	const runtime = resolveRuntimeCsp({
		mediaCdnBaseUrl: 'https://assets.example.org',
		sentryDsn: DSN,
		sentryEnabled: true,
		sentryEnvironment: 'test'
	});
	const event = {} as RequestEvent;

	it('extends the report-only header on rendered pages and sets Reporting-Endpoints', async () => {
		const resolve = vi.fn(
			async () =>
				new Response('<html></html>', {
					headers: {
						'content-type': 'text/html',
						[CSP_REPORT_ONLY_HEADER]: "default-src 'self'; script-src 'self' 'nonce-abc'"
					}
				})
		);
		const response = await createCspHandle(runtime)({ event, resolve });
		const header = response.headers.get(CSP_REPORT_ONLY_HEADER) ?? '';
		expect(header).toContain("script-src 'self' 'nonce-abc'");
		expect(header).toContain('img-src https://assets.example.org');
		expect(header).toContain('report-uri https://o4511563803852800.ingest.de.sentry.io/api/');
		expect(header).toContain('report-to csp-endpoint');
		expect(response.headers.get('reporting-endpoints')).toMatch(/^csp-endpoint="https:\/\//);
		expect(response.headers.get('content-security-policy')).toBeNull();
		expect(await response.text()).toBe('<html></html>');
	});

	it('passes through responses without a CSP header', async () => {
		const original = new Response('{}', { headers: { 'content-type': 'application/json' } });
		const response = await createCspHandle(runtime)({ event, resolve: async () => original });
		expect(response).toBe(original);
		expect(response.headers.get('reporting-endpoints')).toBeNull();
	});

	it('keeps the response when headers are immutable', async () => {
		const immutable = Response.redirect('https://example.org/', 302);
		const headers = new Headers({ [CSP_REPORT_ONLY_HEADER]: "default-src 'self'" });
		Object.defineProperty(immutable, 'headers', {
			value: Object.assign(headers, {
				set: () => {
					throw new TypeError('immutable');
				}
			})
		});
		const response = await createCspHandle(runtime)({ event, resolve: async () => immutable });
		expect(response).toBe(immutable);
	});
});
