type ConvexMonitoringArea = 'auth' | 'backend' | 'email' | 'media';
type ConvexMonitoringLevel = 'error' | 'warning';

type ConvexMonitoringContext = {
	area: ConvexMonitoringArea;
	operation: string;
	level?: ConvexMonitoringLevel;
	identifiers?: Record<string, string | number | boolean | null | undefined>;
};

const SAFE_IDENTIFIER_KEYS = new Set([
	'applicationId',
	'assetId',
	'attemptCount',
	'emailType',
	'failureCode',
	'httpStatus',
	'provider',
	'status'
]);
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const SENSITIVE_PATH_PATTERN =
	/(\/(?:onboarding\/parent-consent|auth\/reset-password)\/)[^/?#\s]+/gi;
const URL_PATTERN = /https?:\/\/[^\s"'<>]+/gi;

const truncate = (value: string, maxLength: number) =>
	value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;

const sanitizeText = (value: string) =>
	value
		.replace(EMAIL_PATTERN, '[Redacted email]')
		.replace(SENSITIVE_PATH_PATTERN, '$1[Redacted]')
		.replace(URL_PATTERN, (rawUrl) => {
			try {
				const url = new URL(rawUrl);
				url.search = '';
				url.hash = '';
				url.pathname = url.pathname.replace(SENSITIVE_PATH_PATTERN, '$1[Redacted]');
				return url.toString();
			} catch {
				return '[Redacted URL]';
			}
		});

const safeIdentifiers = (identifiers: ConvexMonitoringContext['identifiers']) =>
	Object.fromEntries(
		Object.entries(identifiers ?? {}).filter(
			(entry): entry is [string, string | number | boolean | null] =>
				SAFE_IDENTIFIER_KEYS.has(entry[0]) && entry[1] !== undefined
		)
	);

export const reportConvexError = async (error: unknown, context: ConvexMonitoringContext) => {
	const secret = process.env.MONITORING_REPORT_SECRET?.trim();
	const baseUrl = process.env.BETTER_AUTH_URL?.trim();
	if (!secret || !baseUrl) return false;

	const normalized = error instanceof Error ? error : new Error(String(error));
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 2500);

	try {
		const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/internal/monitoring/report`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'x-monitoring-secret': secret
			},
			body: JSON.stringify({
				area: context.area,
				operation: context.operation,
				level: context.level ?? 'error',
				name: truncate(sanitizeText(normalized.name), 120),
				message: truncate(sanitizeText(normalized.message), 1000),
				stack: normalized.stack ? truncate(sanitizeText(normalized.stack), 8000) : undefined,
				identifiers: safeIdentifiers(context.identifiers)
			}),
			signal: controller.signal
		});
		if (!response.ok) {
			console.warn('monitoring:report:rejected', { status: response.status });
		}
		return response.ok;
	} catch {
		console.warn('monitoring:report:failed');
		return false;
	} finally {
		clearTimeout(timeout);
	}
};
