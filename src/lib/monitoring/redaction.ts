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
// `username` is kept apart from the other labels: a username has no spaces, so an unquoted one
// is a single word and the words after it (`username=ava is already taken`) stay.
const USERNAME_LABEL = 'user[ _-]?name';
const PERSON_NAME_LABEL =
	"(?:display[ _-]?name|first[ _-]?name|last[ _-]?name|full[ _-]?name|given[ _-]?name|family[ _-]?name|nick[ _-]?name|preferred[ _-]?name|(?:child|parent|guardian)(?:'s)?[ _-]?name)";
const NAME_LABEL = `(?:${USERNAME_LABEL}|${PERSON_NAME_LABEL})`;
// After the label: an optional closing quote of a JSON key (`"firstName"` or, inside a string
// that holds JSON, `\"firstName\"`), then `:` or `=`.
const LABEL_TAIL = '(?:\\\\?")?\\s*[:=]?\\s*';
// A quoted value. Escaped quotes inside it (`"Ava \"A\" B"`) are part of the value. A value
// quoted with `\"` (JSON inside a string) ends at the next `\"` that is not part of a
// double-escaped inner quote (`\\\"`) or an escaped backslash (`\\`).
const QUOTED_VALUE = [
	String.raw`\\"(?:\\\\\\"|\\\\|[^\\\n]|\\(?!"))*\\"`,
	String.raw`"(?:[^"\\\n]|\\.)*"`,
	String.raw`'(?:[^'\\\n]|\\.)*'`,
	'“[^”\\n]*”'
].join('|');
const LABELLED_QUOTED_NAME_PATTERN = new RegExp(
	`(\\b${NAME_LABEL}${LABEL_TAIL})(?:${QUOTED_VALUE})`,
	'gi'
);
// An unquoted person's name runs to the next delimiter, so `full name: Ava Brown` loses the
// surname too. It also stops before a word that starts another `key:` / `key=` pair. An
// unquoted username is one word.
const BARE_WORD = '[^\\s,;|)}\\]]+';
const NOT_QUOTED = `(?!["'“\\[\\\\])`;
const LABELLED_BARE_NAME_PATTERN = new RegExp(
	`(\\b${PERSON_NAME_LABEL}\\s*[:=]\\s*)${NOT_QUOTED}${BARE_WORD}(?:[ \\t]+(?!\\S*[:=])${BARE_WORD})*`,
	'gi'
);
const LABELLED_BARE_USERNAME_PATTERN = new RegExp(
	`(\\b${USERNAME_LABEL}\\s*[:=]\\s*)${NOT_QUOTED}${BARE_WORD}`,
	'gi'
);
// Element attributes Sentry copies into ui.click / ui.input breadcrumbs, whose values can be
// a label such as "Remove Ava from club". Sentry does not escape quotes in the value
// (`[aria-label="Remove ["Ava"] Brown"]`), so the value runs to the quote and `]` that end
// the attribute: the ones followed by the next attribute, a ` > ` step or the end.
const ELEMENT_TEXT_ATTRIBUTE_PATTERN =
	/(\[(?:aria-label|title|alt)=)(["'])[\s\S]*?\2(\])(?=\[|\s+>\s|\s*$)/gi;

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
		.replace(LABELLED_QUOTED_NAME_PATTERN, (match, label: string) =>
			// Keep `\"` quoting so JSON held inside a string stays valid.
			match.slice(label.length).startsWith('\\"')
				? `${label}\\"[Redacted name]\\"`
				: `${label}"[Redacted name]"`
		)
		.replace(LABELLED_BARE_NAME_PATTERN, '$1[Redacted name]')
		.replace(LABELLED_BARE_USERNAME_PATTERN, '$1[Redacted name]')
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

// Headers that carry the visitor's IP address on Vercel and behind proxies.
const IP_HEADER_PATTERN =
	/^(?:x-forwarded-for|x-real-ip|x-vercel-forwarded-for|x-vercel-ip.*|cf-connecting-ip|true-client-ip|forwarded)$/i;

// Expects a breadcrumb that already went through redactUnknown.
const scrubUiBreadcrumb = (breadcrumb: Breadcrumb): Breadcrumb => {
	if (
		typeof breadcrumb?.category === 'string' &&
		breadcrumb.category.startsWith('ui.') &&
		typeof breadcrumb.message === 'string'
	) {
		return {
			...breadcrumb,
			message: breadcrumb.message.replace(ELEMENT_TEXT_ATTRIBUTE_PATTERN, '$1"[Redacted]"$3')
		};
	}
	return breadcrumb;
};

const redactEventPayload = <T extends ErrorEvent | TransactionEvent>(event: T): T => {
	const redacted = redactUnknown(event) as T;
	delete redacted.user;
	// The browser SDK sets this itself when sendDefaultPii is off; the SvelteKit server SDK does
	// not, so set it on every event to stop Sentry storing the sender's IP.
	// Set even when the event has no sdk block (default integrations off).
	redacted.sdk = {
		...redacted.sdk,
		settings: { ...redacted.sdk?.settings, infer_ip: 'never' }
	} as NonNullable<T['sdk']>;
	// Breadcrumbs attached to the event directly (scope.addBreadcrumb with a hint, or
	// event.breadcrumbs from captureEvent) skip beforeBreadcrumb.
	if (Array.isArray(redacted.breadcrumbs)) {
		redacted.breadcrumbs = redacted.breadcrumbs.map(scrubUiBreadcrumb);
	}

	if (redacted.request) {
		delete redacted.request.cookies;
		delete redacted.request.data;
		delete redacted.request.query_string;
		delete redacted.request.env;
		if (redacted.request.headers) {
			for (const header of Object.keys(redacted.request.headers)) {
				if (IP_HEADER_PATTERN.test(header)) delete redacted.request.headers[header];
			}
		}
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

export const redactSentryBreadcrumb = (breadcrumb: Breadcrumb): Breadcrumb =>
	scrubUiBreadcrumb(redactUnknown(breadcrumb) as Breadcrumb);
