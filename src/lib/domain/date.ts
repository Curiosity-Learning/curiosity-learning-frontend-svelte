export const formatDateTime = (input: number | null | undefined) => {
	if (!input) {
		return 'N/A';
	}
	return new Date(input).toLocaleString();
};

/** Short date label, e.g. "5 Jan 2026" — used for due dates, deadlines, etc. */
export const formatShortDate = (input: number) =>
	new Date(input).toLocaleDateString(undefined, {
		day: 'numeric',
		month: 'short',
		year: 'numeric'
	});

/** Month + year label, e.g. "January 2026" — used for "joined on" style copy. */
export const formatMonthYear = (input: number) =>
	new Date(input).toLocaleDateString(undefined, {
		month: 'long',
		year: 'numeric'
	});

/** Clock time label, e.g. "2:30 PM" — used for chat/message timestamps. */
export const formatClockTime = (input: number) =>
	new Date(input).toLocaleTimeString(undefined, {
		hour: 'numeric',
		minute: '2-digit'
	});

/** Midnight (local time) timestamp of the calendar day containing the input. */
export const startOfDay = (timestamp: number) => new Date(timestamp).setHours(0, 0, 0, 0);

/**
 * Whole calendar days between today and the day containing the input, in local time
 * (0 = today, 1 = yesterday). Rounded so DST shifts don't produce off-by-one days.
 */
export const calendarDaysAgo = (timestamp: number) =>
	Math.round((startOfDay(Date.now()) - startOfDay(timestamp)) / 86_400_000);

export const toTimestamp = (value: string) => {
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? null : date.getTime();
};

/**
 * Formats a timestamp as a short relative time label (e.g. "2d", "5h", "now"),
 * falling back to a short date once the timestamp is a week or more in the past.
 */
export const formatRelativeTime = (timestamp: number) => {
	const diff = Date.now() - timestamp;
	if (diff <= 0) return 'now';

	const minutes = Math.floor(diff / 60_000);
	if (minutes < 1) return 'now';
	if (minutes < 60) return `${minutes}m`;

	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h`;

	const days = Math.floor(hours / 24);
	if (days < 7) return `${days}d`;

	return new Date(timestamp).toLocaleDateString(undefined, {
		month: 'short',
		day: 'numeric'
	});
};
