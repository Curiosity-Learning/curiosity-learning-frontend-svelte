import { describe, expect, it } from 'vitest';
import {
	combineDateAndTime,
	formatScheduleSlot,
	nextOccurrenceOfDay,
	nextScheduledSession,
	type ScheduleSlot
} from './schedule';

describe('formatScheduleSlot', () => {
	it('formats day, time range, and location', () => {
		expect(
			formatScheduleSlot({
				dayOfWeek: 'tuesday',
				startTime: '16:00',
				endTime: '17:30',
				location: 'Library'
			})
		).toBe('Tuesdays 16:00–17:30 · Library');
	});

	it('omits the separator when location is empty', () => {
		expect(
			formatScheduleSlot({ dayOfWeek: 'monday', startTime: '09:00', endTime: '10:00', location: '' })
		).toBe('Mondays 09:00–10:00');
	});
});

describe('nextOccurrenceOfDay', () => {
	it('finds the next occurrence later in the same week', () => {
		// Monday, Jan 5, 2026
		const monday = new Date(2026, 0, 5);
		const result = nextOccurrenceOfDay('wednesday', monday);
		expect(result).toEqual(new Date(2026, 0, 7));
	});

	it('wraps to next week when the target day already passed', () => {
		// Friday, Jan 9, 2026
		const friday = new Date(2026, 0, 9);
		const result = nextOccurrenceOfDay('monday', friday);
		expect(result).toEqual(new Date(2026, 0, 12));
	});

	it('returns the same weekday 7 days later when after falls on that day', () => {
		// Tuesday, Jan 6, 2026
		const tuesday = new Date(2026, 0, 6);
		const result = nextOccurrenceOfDay('tuesday', tuesday);
		expect(result).toEqual(new Date(2026, 0, 13));
	});

	it('ignores time-of-day on the `after` argument', () => {
		const tuesdayEvening = new Date(2026, 0, 6, 23, 45);
		const result = nextOccurrenceOfDay('wednesday', tuesdayEvening);
		expect(result).toEqual(new Date(2026, 0, 7));
	});
});

describe('nextScheduledSession', () => {
	const tuesdaySlot: ScheduleSlot = {
		dayOfWeek: 'tuesday',
		startTime: '16:00',
		endTime: '17:30',
		location: 'Library'
	};
	const thursdaySlot: ScheduleSlot = {
		dayOfWeek: 'thursday',
		startTime: '14:00',
		endTime: '15:30',
		location: 'Park'
	};

	it('returns null when there are no slots', () => {
		expect(nextScheduledSession([], new Date(2026, 0, 5), null)).toBeNull();
	});

	it('picks the earliest upcoming slot after today when there is no last session', () => {
		// Monday, Jan 5, 2026 -> Tuesday, Jan 6 comes before Thursday, Jan 8
		const monday = new Date(2026, 0, 5);
		const result = nextScheduledSession([tuesdaySlot, thursdaySlot], monday, null);
		expect(result?.slot).toBe(tuesdaySlot);
		expect(result?.date).toEqual(new Date(2026, 0, 6));
	});

	it('picks the earliest slot after the last planned session, not after today', () => {
		// Today is far in the past relative to the last planned session.
		const now = new Date(2026, 0, 1);
		const lastSession = new Date(2026, 0, 6); // a Tuesday
		const result = nextScheduledSession([tuesdaySlot, thursdaySlot], now, lastSession);
		// Next occurrence strictly after Jan 6 (Tue) is Thursday Jan 8.
		expect(result?.slot).toBe(thursdaySlot);
		expect(result?.date).toEqual(new Date(2026, 0, 8));
	});

	it('uses today when the last planned session is in the past', () => {
		const now = new Date(2026, 0, 5); // Monday
		const lastSession = new Date(2025, 11, 1); // long past
		const result = nextScheduledSession([tuesdaySlot], now, lastSession);
		expect(result?.date).toEqual(new Date(2026, 0, 6));
	});
});

describe('combineDateAndTime', () => {
	it('combines a local date with an HH:MM time string', () => {
		const date = new Date(2026, 0, 6);
		const ts = combineDateAndTime(date, '16:30');
		const result = new Date(ts);
		expect(result.getFullYear()).toBe(2026);
		expect(result.getMonth()).toBe(0);
		expect(result.getDate()).toBe(6);
		expect(result.getHours()).toBe(16);
		expect(result.getMinutes()).toBe(30);
	});
});
