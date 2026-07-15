import * as Sentry from '@sentry/sveltekit';
import type { Handle } from '@sveltejs/kit';

export type ApiLogLevel = 'info' | 'warn' | 'error';

export type ApiRequestOutcome = {
	method: string;
	routeId: string;
	status: number;
	durationMs: number;
};

export type ApiLogEntry = {
	level: ApiLogLevel;
	message: string;
	data: ApiRequestOutcome;
};

const levelForStatus = (status: number): ApiLogLevel => {
	if (status >= 500) return 'error';
	if (status >= 400) return 'warn';
	return 'info';
};

/** Builds a Sentry log entry for one API request. Only safe, low-cardinality fields — never URLs, headers, or bodies. */
export const buildApiLogEntry = (outcome: ApiRequestOutcome): ApiLogEntry => ({
	level: levelForStatus(outcome.status),
	message: `${outcome.method} ${outcome.routeId} -> ${outcome.status}`,
	data: outcome
});

/** Logs every request to an /api/** route to Sentry as a structured log. Runs inside sentryHandle's scope. */
export const logApiRequests: Handle = async ({ event, resolve }) => {
	const routeId = event.route.id;
	if (!routeId || !routeId.startsWith('/api')) {
		return resolve(event);
	}

	const startedAt = Date.now();
	const response = await resolve(event);

	if (Sentry.isEnabled()) {
		const entry = buildApiLogEntry({
			method: event.request.method,
			routeId,
			status: response.status,
			durationMs: Date.now() - startedAt
		});
		Sentry.logger[entry.level](entry.message, entry.data);
	}

	return response;
};