export const formatDateTime = (input: number | null | undefined) => {
	if (!input) {
		return 'N/A';
	}
	return new Date(input).toLocaleString();
};

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
