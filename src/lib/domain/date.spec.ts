import { describe, expect, it } from 'vitest';
import { formatDateTime, formatRelativeTime, toTimestamp } from './date';

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
});

describe('formatRelativeTime', () => {
	it('formats sub-minute and future timestamps as "now"', () => {
		expect(formatRelativeTime(Date.now())).toBe('now');
		expect(formatRelativeTime(Date.now() + 60_000)).toBe('now');
	});

	it('formats minutes, hours, and days', () => {
		expect(formatRelativeTime(Date.now() - 5 * 60_000)).toBe('5m');
		expect(formatRelativeTime(Date.now() - 3 * 60 * 60_000)).toBe('3h');
		expect(formatRelativeTime(Date.now() - 2 * 24 * 60 * 60_000)).toBe('2d');
	});

	it('falls back to a short date after a week', () => {
		const result = formatRelativeTime(Date.now() - 10 * 24 * 60 * 60_000);
		expect(result).not.toMatch(/[dhm]$/);
	});
});
