import { timingSafeEqual } from 'node:crypto';
import { parseOperationalReportPayload } from '$lib/monitoring/payload';

export const MAX_MONITORING_REPORT_BYTES = 16 * 1024;

export const hasValidMonitoringSecret = (received: string | null, expected: string | undefined) => {
	if (!received || !expected) return false;
	const receivedBytes = Buffer.from(received);
	const expectedBytes = Buffer.from(expected);
	return (
		receivedBytes.length === expectedBytes.length && timingSafeEqual(receivedBytes, expectedBytes)
	);
};

export const parseMonitoringReportBody = (body: string) => {
	if (Buffer.byteLength(body, 'utf8') > MAX_MONITORING_REPORT_BYTES) {
		return null;
	}
	try {
		return parseOperationalReportPayload(JSON.parse(body));
	} catch {
		return null;
	}
};
