import * as Sentry from '@sentry/sveltekit';
import { json } from '@sveltejs/kit';
import { captureOperationalError } from '$lib/monitoring/capture';
import {
	MAX_MONITORING_REPORT_BYTES,
	hasValidMonitoringSecret,
	parseMonitoringReportBody
} from '$lib/server/monitoring-report';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const expectedSecret = process.env.MONITORING_REPORT_SECRET;
	if (!expectedSecret) {
		return json({ error: 'Monitoring reporter is not configured.' }, { status: 503 });
	}

	if (!hasValidMonitoringSecret(request.headers.get('x-monitoring-secret'), expectedSecret)) {
		return json({ error: 'Unauthorized.' }, { status: 401 });
	}

	const contentLength = Number(request.headers.get('content-length') ?? 0);
	if (contentLength > MAX_MONITORING_REPORT_BYTES) {
		return json({ error: 'Report is too large.' }, { status: 413 });
	}

	const payload = parseMonitoringReportBody(await request.text());
	if (!payload) {
		return json({ error: 'Invalid monitoring report.' }, { status: 400 });
	}

	const error = new Error(payload.message);
	error.name = payload.name ?? 'ConvexOperationalError';
	if (payload.stack) error.stack = payload.stack;
	captureOperationalError(error, payload);
	await Sentry.flush(1500);
	return new Response(null, { status: 202 });
};
