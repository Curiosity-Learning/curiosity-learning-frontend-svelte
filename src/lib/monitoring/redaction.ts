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
// A label followed by an optional closing quote of a JSON key (`"firstName"` or, inside a
// string that holds JSON, `\"firstName\"`), then `:` or `=`. Only the label is matched by a
// regex; the quoted value after it is read by scanQuotedValue, which never backtracks.
const LABEL_BEFORE_QUOTE_PATTERN = new RegExp(
	`\\b${NAME_LABEL}(?:\\\\?")?[ \\t]*[:=]?[ \\t]*`,
	'gi'
);

/**
 * Reads the quoted value that starts at `start`, in one pass (O(n), no regex). Returns the
 * index just past its closing quote and the opening it used, or null when `start` is not a
 * quote. An unterminated value runs to the end of the line, so it is still redacted.
 * - `"…"` and `'…'`: a backslash escapes the next character, so `"Ava \"A\" B"` is one value.
 * - `\"…\"` (JSON inside a string): `\\\"` is a double-escaped inner quote and `\\` an escaped
 *   backslash; the value ends at the next other `\"`.
 * - `“…”`: ends at `”`.
 */
const scanQuotedValue = (text: string, start: number): { end: number; open: string } | null => {
	const lineEnd = (from: number) => {
		const newline = text.indexOf('\n', from);
		return newline === -1 ? text.length : newline;
	};
	const first = text[start];
	if (first === '\\' && text[start + 1] === '"') {
		let i = start + 2;
		while (i < text.length && text[i] !== '\n') {
			if (text[i] !== '\\') {
				i += 1;
			} else if (text[i + 1] === '"') {
				return { end: i + 2, open: '\\"' };
			} else if (text[i + 1] === '\\') {
				// `\\\"` is an inner quote, `\\` an escaped backslash: both stay in the value.
				i += text[i + 2] === '\\' && text[i + 3] === '"' ? 4 : 2;
			} else {
				i += 1;
			}
		}
		return { end: lineEnd(i), open: '\\"' };
	}
	if (first === '"' || first === "'") {
		let i = start + 1;
		while (i < text.length && text[i] !== '\n') {
			if (text[i] === '\\') {
				i += 2;
			} else if (text[i] === first) {
				return { end: i + 1, open: '"' };
			} else {
				i += 1;
			}
		}
		return { end: lineEnd(Math.min(i, text.length)), open: '"' };
	}
	if (first === '“') {
		const close = text.indexOf('”', start + 1);
		const end = lineEnd(start + 1);
		return { end: close !== -1 && close < end ? close + 1 : end, open: '"' };
	}
	return null;
};

const redactLabelledQuotedNames = (text: string) => {
	let result = '';
	let copiedTo = 0;
	LABEL_BEFORE_QUOTE_PATTERN.lastIndex = 0;
	for (let match = LABEL_BEFORE_QUOTE_PATTERN.exec(text); match; ) {
		const valueStart = match.index + match[0].length;
		const value = scanQuotedValue(text, valueStart);
		if (value) {
			// Keep `\"` quoting so JSON held inside a string stays valid.
			result += `${text.slice(copiedTo, valueStart)}${value.open}[Redacted name]${value.open}`;
			copiedTo = value.end;
			LABEL_BEFORE_QUOTE_PATTERN.lastIndex = value.end;
		} else if (match[0].length === 0) {
			LABEL_BEFORE_QUOTE_PATTERN.lastIndex += 1;
		}
		match = LABEL_BEFORE_QUOTE_PATTERN.exec(text);
	}
	return result + text.slice(copiedTo);
};
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
// a label such as "Remove Ava from club". Sentry builds the selector as `tag#id.class[attr="v"]`
// steps joined by ` > ` and does not escape the value, so `Remove ["Ava"] > Brown` can appear
// inside it. The value therefore ends only at a quote and `]` after which the rest of the
// selector still parses: the end, another `[attr=`, or ` > ` and a step whose tag name is
// followed by `#`, `.`, `[`, ` > ` or the end. If no such closer exists, the rest is redacted.
const ELEMENT_TEXT_ATTRIBUTE_PATTERN = /\[(?:aria-label|title|alt)=(["'])/gi;
const SELECTOR_CONTINUATION_PATTERN = /$|\[[\w-]+=| > [a-z][\w-]*(?:[#.[]| > |$)/iy;

const redactElementTextAttributes = (selector: string) => {
	let result = '';
	let copiedTo = 0;
	ELEMENT_TEXT_ATTRIBUTE_PATTERN.lastIndex = 0;
	for (let match = ELEMENT_TEXT_ATTRIBUTE_PATTERN.exec(selector); match; ) {
		const quote = match[1];
		const valueStart = match.index + match[0].length;
		let end = selector.length;
		for (let close = selector.indexOf(`${quote}]`, valueStart); close !== -1; ) {
			SELECTOR_CONTINUATION_PATTERN.lastIndex = close + 2;
			if (SELECTOR_CONTINUATION_PATTERN.test(selector)) {
				end = close + 2;
				break;
			}
			close = selector.indexOf(`${quote}]`, close + 1);
		}
		result += `${selector.slice(copiedTo, match.index)}${match[0].slice(0, -1)}"[Redacted]"]`;
		copiedTo = end;
		ELEMENT_TEXT_ATTRIBUTE_PATTERN.lastIndex = end;
		match = ELEMENT_TEXT_ATTRIBUTE_PATTERN.exec(selector);
	}
	return result + selector.slice(copiedTo);
};

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
	redactLabelledQuotedNames(value.replace(EMAIL_PATTERN, '[Redacted email]'))
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
			message: redactElementTextAttributes(breadcrumb.message)
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
