/**
 * Splits free-form text into plain-text and URL segments so callers can
 * render http(s) URLs as clickable links while leaving everything else
 * (e.g. a plain address) as text.
 */
export type LinkifySegment = { type: 'text' | 'url'; value: string };

const URL_PATTERN = /\bhttps?:\/\/[^\s<>"']+/gi;

/**
 * Trims trailing punctuation that's usually not part of the URL itself
 * (e.g. a period ending a sentence, or a closing paren without a matching
 * opening one).
 */
const trimTrailingPunctuation = (url: string): string => {
	let trimmed = url;
	while (trimmed.length > 0) {
		const lastChar = trimmed[trimmed.length - 1];
		if (',.;:!?'.includes(lastChar)) {
			trimmed = trimmed.slice(0, -1);
			continue;
		}
		if (lastChar === ')' && !trimmed.includes('(')) {
			trimmed = trimmed.slice(0, -1);
			continue;
		}
		break;
	}
	return trimmed;
};

/**
 * Returns true if the entire (trimmed) string is a single http(s) URL.
 */
export const isUrl = (value: string): boolean => {
	const trimmed = value.trim();
	if (!trimmed) return false;
	const matches = trimmed.match(URL_PATTERN);
	if (!matches || matches.length !== 1) return false;
	return trimTrailingPunctuation(matches[0]) === trimmed;
};

/**
 * Splits `text` into segments of plain text and detected http(s) URLs,
 * preserving order and original spacing.
 */
export const linkifySegments = (text: string): LinkifySegment[] => {
	if (!text) return [];

	const segments: LinkifySegment[] = [];
	let lastIndex = 0;
	const pattern = new RegExp(URL_PATTERN);
	let match: RegExpExecArray | null;

	while ((match = pattern.exec(text)) !== null) {
		const rawUrl = match[0];
		const url = trimTrailingPunctuation(rawUrl);
		const start = match.index;
		const end = start + url.length;

		if (start > lastIndex) {
			segments.push({ type: 'text', value: text.slice(lastIndex, start) });
		}
		segments.push({ type: 'url', value: url });
		lastIndex = end;
	}

	if (lastIndex < text.length) {
		segments.push({ type: 'text', value: text.slice(lastIndex) });
	}

	return segments;
};
