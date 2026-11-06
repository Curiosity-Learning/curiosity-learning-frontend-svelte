// CL-770 (Ron, 2026-11-05): seasons are planned in calendar DATES. Nobody enters a time; the
// official moment of each date comes from one fixed rule, so "applications close on 7 November"
// always means 23:55 GMT that day, everywhere it is shown or enforced.
//
// - Closing dates (application deadline, scoring deadline, season end, feedback deadline) are the
//   end of that day: 23:55 GMT.
// - The season start is the beginning of that day: 00:00 GMT.
//
// GMT is used as written in the emails ("23:55 GMT"), i.e. UTC with no daylight saving shift.
// Stored values stay absolute ms timestamps, so every existing comparison (review windows,
// feedback enforcement) keeps working unchanged.

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export const SEASON_CLOSING_HOUR_GMT = 23;
export const SEASON_CLOSING_MINUTE_GMT = 55;

const parseSeasonDate = (date: string) => {
	const match = DATE_PATTERN.exec(date);
	if (!match) return null;
	const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
	const startOfDay = Date.UTC(year, month - 1, day);
	// Reject impossible dates such as 2026-02-31, which Date.UTC would roll over.
	const check = new Date(startOfDay);
	if (
		check.getUTCFullYear() !== year ||
		check.getUTCMonth() !== month - 1 ||
		check.getUTCDate() !== day
	) {
		return null;
	}
	return startOfDay;
};

export const isSeasonDate = (date: string) => parseSeasonDate(date) !== null;

/** 23:55 GMT on the given YYYY-MM-DD date. Throws on a malformed date. */
export const seasonClosingMoment = (date: string) => {
	const startOfDay = parseSeasonDate(date);
	if (startOfDay === null) throw new Error(`Invalid date "${date}" (expected YYYY-MM-DD)`);
	return startOfDay + (SEASON_CLOSING_HOUR_GMT * 60 + SEASON_CLOSING_MINUTE_GMT) * 60 * 1000;
};

/** 00:00 GMT on the given YYYY-MM-DD date. Throws on a malformed date. */
export const seasonStartMoment = (date: string) => {
	const startOfDay = parseSeasonDate(date);
	if (startOfDay === null) throw new Error(`Invalid date "${date}" (expected YYYY-MM-DD)`);
	return startOfDay;
};

/** The GMT calendar date (YYYY-MM-DD) of a stored season moment, for editing forms. */
export const seasonDateOf = (moment: number) => new Date(moment).toISOString().slice(0, 10);

// Formatted by hand rather than with Intl: these run inside Convex functions, and the wording
// must not depend on the runtime's locale data.
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December'
];

/** "Saturday 7 November" in GMT, the way deadlines are written in emails. */
export const formatSeasonDay = (moment: number) => {
	const date = new Date(moment);
	return `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
};

/** "Saturday 7 November, 23:55 GMT". */
export const formatSeasonDeadline = (moment: number) => {
	const date = new Date(moment);
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${formatSeasonDay(moment)}, ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} GMT`;
};
