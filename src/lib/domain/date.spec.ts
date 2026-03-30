import { describe, expect, it } from 'vitest';
import { formatDateTime, formatMeetingTime, formatWeeklyMeetingLabel, toTimestamp } from './date';

describe('date domain helpers', () => {
	it('returns fallback text for empty values', () => {
		expect(formatDateTime(null)).toBe('N/A');
		expect(formatDateTime(undefined)).toBe('N/A');
	});

	it('converts valid date strings to timestamps', () => {
		const ts = toTimestamp('2026-01-01T08:30:00.000Z');
		expect(ts).not.toBeNull();
		expect(typeof ts).toBe('number');
	});

	it('returns null for invalid date strings', () => {
		expect(toTimestamp('not-a-date')).toBeNull();
	});

	it('formats 24-hour meeting times in am/pm format', () => {
		expect(formatMeetingTime('16:00')).toBe('4:00 pm');
		expect(formatMeetingTime('09:30')).toBe('9:30 am');
	});

	it('builds weekly meeting labels with weekday and time', () => {
		expect(formatWeeklyMeetingLabel('Wednesday', '16:00')).toBe('Wednesdays at 4:00 pm');
		expect(formatWeeklyMeetingLabel('Wednesdays', '4:00 pm')).toBe('Wednesdays at 4:00 pm');
	});

	it('handles partial weekly meeting label inputs', () => {
		expect(formatWeeklyMeetingLabel('Tuesday', '')).toBe('Tuesdays');
		expect(formatWeeklyMeetingLabel('', '12:00')).toBe('12:00 pm');
	});
});
