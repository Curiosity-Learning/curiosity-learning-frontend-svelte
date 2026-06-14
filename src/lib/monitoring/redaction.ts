import type { ErrorEvent } from '@sentry/sveltekit';

const REDACTED = '[Redacted]';
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const SENSITIVE_KEY_PATTERN =
	/(authorization|cookie|password|secret|token|api[-_]?key|private[-_]?key|signature|credential|email|body|formdata)/i;
const SENSITIVE_PATH_PATTERN =
	/(\/(?:onboarding\/parent-consent|auth\/reset-password)\/)[^/?#\s]+/gi;
const URL_PATTERN = /https?:\/\/[^\s"'<>]+/gi;

const sanitizeUrl = (value: string) => {
	try {
		const url = new URL(value);
		url.search = '';
		url.hash = '';
		url.pathname = url.pathname.replace(SENSITIVE_PATH_PATTERN, '$1[Redacted]');
		return url.toString();
	} catch {
		return value.replace(SENSITIVE_PATH_PATTERN, '$1[Redacted]');
	}
};

export const redactText = (value: string) =>
	value
		.replace(EMAIL_PATTERN, '[Redacted email]')
		.replace(SENSITIVE_PATH_PATTERN, '$1[Redacted]')
		.replace(URL_PATTERN, (url) => sanitizeUrl(url));

export const redactUnknown = (value: unknown, key = '', depth = 0): unknown => {
	if (SENSITIVE_KEY_PATTERN.test(key)) {
		return REDACTED;
	}
	if (depth > 8) {
		return '[Truncated]';
	}
	if (typeof value === 'string') {
		return redactText(value);
	}
	if (Array.isArray(value)) {
		return value.map((entry) => redactUnknown(entry, '', depth + 1));
	}
	if (value && typeof value === 'object') {
		return Object.fromEntries(
			Object.entries(value).map(([entryKey, entryValue]) => [
				entryKey,
				redactUnknown(entryValue, entryKey, depth + 1)
			])
		);
	}
	return value;
};

export const redactSentryEvent = (event: ErrorEvent): ErrorEvent => {
	const redacted = redactUnknown(event) as ErrorEvent;
	delete redacted.user;

	if (redacted.request) {
		delete redacted.request.cookies;
		delete redacted.request.data;
		delete redacted.request.query_string;
		if (redacted.request.url) {
			redacted.request.url = sanitizeUrl(redacted.request.url);
		}
	}

	return redacted;
};
