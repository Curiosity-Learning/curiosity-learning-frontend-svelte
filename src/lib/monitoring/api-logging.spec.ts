import { describe, expect, it } from 'vitest';
import { buildApiLogEntry } from './api-logging';

describe('buildApiLogEntry', () => {
	it('logs successful and redirect responses at info level', () => {
		expect(
			buildApiLogEntry({ method: 'GET', routeId: '/api/media/refresh', status: 200, durationMs: 12 })
				.level
		).toBe('info');
		expect(
			buildApiLogEntry({ method: 'GET', routeId: '/api/media/refresh', status: 302, durationMs: 12 })
				.level
		).toBe('info');
	});

	it('logs client errors at warn level', () => {
		expect(
			buildApiLogEntry({ method: 'POST', routeId: '/api/webhooks/resend', status: 401, durationMs: 5 })
				.level
		).toBe('warn');
		expect(
			buildApiLogEntry({ method: 'POST', routeId: '/api/webhooks/resend', status: 499, durationMs: 5 })
				.level
		).toBe('warn');
	});

	it('logs server errors at error level', () => {
		expect(
			buildApiLogEntry({
				method: 'POST',
				routeId: '/api/internal/monitoring/report',
				status: 503,
				durationMs: 40
			}).level
		).toBe('error');
	});

	it('only includes method, routeId, status, and durationMs in the logged data', () => {
		const entry = buildApiLogEntry({
			method: 'POST',
			routeId: '/api/webhooks/resend',
			status: 202,
			durationMs: 8
		});

		expect(entry.data).toEqual({
			method: 'POST',
			routeId: '/api/webhooks/resend',
			status: 202,
			durationMs: 8
		});
		expect(entry.message).toBe('POST /api/webhooks/resend -> 202');
	});
});
