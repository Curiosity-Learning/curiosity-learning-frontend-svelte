import type { Breadcrumb, ErrorEvent, Log } from '@sentry/sveltekit';
// Not re-exported by @sentry/sveltekit; @sentry/core is its direct dependency.
import type { TransactionEvent } from '@sentry/core';

const REDACTED = '[Redacted]';
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const SENSITIVE_KEY_PATTERN =
	/(authorization|cookie|password|secret|token|api[-_]?key|private[-_]?key|signature|credential|email|body|formdata)/i;
const SENSITIVE_PATH_PATTERN =
	/(\/(?:onboarding\/parent-consent|auth\/reset-password|verify-email)\/)[^/?#\s]+/gi;
// Tokens in a query or fragment of a URL that is not absolute (absolute URLs lose both in
// sanitizeUrl): the sign-in link interstitial's `#t=` and Better Auth's `?token=`.
const SENSITIVE_PARAM_PATTERN = /([?&#](?:t|token)=)[^&#\s"'<>]+/gi;
const URL_PATTERN = /https?:\/\/[^\s"'<>]+/gi;
// Keys that hold a person's name. Plain `name` is left alone: Sentry uses it for the SDK,
// browser, OS and runtime, and the app uses it for clubs, forms and functions.
const NAME_KEY_PATTERN =
	/^(?:user_?name|display_?name|first_?name|last_?name|full_?name|given_?name|family_?name|nick_?name|preferred_?name|child_?name|parent_?name|guardian_?name)$/i;
// The same labels in free text: `username: ava`, `display name "Ava B"`, `{"firstName":"Ava"}`.
// Names cannot be recognised without a label, so code must put ids, not names, in error
// messages (docs/monitoring.md); this is the safety net for when it does not.
const NAME_LABEL =
	"(?:user[ _-]?name|display[ _-]?name|first[ _-]?name|last[ _-]?name|full[ _-]?name|given[ _-]?name|family[ _-]?name|nick[ _-]?name|preferred[ _-]?name|(?:child|parent|guardian)(?:'s)?[ _-]?name)";
const LABELLED_QUOTED_NAME_PATTERN = new RegExp(
	`(\\b${NAME_LABEL}"?\\s*[:=]?\\s*)("[^"]*"|'[^']*'|“[^”]*”)`,
	'gi'
);
const LABELLED_BARE_NAME_PATTERN = new RegExp(
	`(\\b${NAME_LABEL}\\s*[:=]\\s*)(?!["'“\\[])[^\\s,;)}\\]]+`,
	'gi'
);
// Element attributes Sentry copies into ui.click / ui.input breadcrumbs, whose values can be
// a label such as "Remove Ava from club".
const ELEMENT_TEXT_ATTRIBUTE_PATTERN = /(\[(?:aria-label|title|alt)=)("[^"]*"|'[^']*')(\])/gi;

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
		.replace(LABELLED_QUOTED_NAME_PATTERN, '$1"[Redacted name]"')
		.replace(LABELLED_BARE_NAME_PATTERN, '$1[Redacted name]')
		.replace(SENSITIVE_PATH_PATTERN, '$1[Redacted]')
		.replace(SENSITIVE_PARAM_PATTERN, '$1[Redacted]')
		.replace(URL_PATTERN, (url) => sanitizeUrl(url));

export const redactUnknown = (value: unknown, key = '', depth = 0): unknown => {
	if (SENSITIVE_KEY_PATTERN.test(key) || NAME_KEY_PATTERN.test(key)) {
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

const redactEventPayload = <T extends ErrorEvent | TransactionEvent>(event: T): T => {
	const redacted = redactUnknown(event) as T;
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

export const redactSentryEvent = (event: ErrorEvent): ErrorEvent => redactEventPayload(event);

// Transactions carry request/page URLs and span data that beforeSend never sees.
export const redactSentryTransaction = (event: TransactionEvent): TransactionEvent =>
	redactEventPayload(event);

// Floor for structured logs, independent of whether the call site sanitized its data.
export const redactSentryLog = (log: Log): Log => redactUnknown(log) as Log;

export const redactSentryBreadcrumb = (breadcrumb: Breadcrumb): Breadcrumb => {
	const redacted = redactUnknown(breadcrumb) as Breadcrumb;
	if (redacted.category?.startsWith('ui.') && typeof redacted.message === 'string') {
		redacted.message = redacted.message.replace(ELEMENT_TEXT_ATTRIBUTE_PATTERN, '$1"[Redacted]"$3');
	}
	return redacted;
};
