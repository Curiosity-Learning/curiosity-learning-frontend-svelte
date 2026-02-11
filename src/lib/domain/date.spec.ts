import { describe, expect, it } from 'vitest';
import { formatDateTime, toTimestamp } from './date';

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
