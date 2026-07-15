import { describe, expect, it } from 'vitest';
import {
	buildDefaultSessionForm,
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

describe('buildDefaultSessionForm', () => {
	const tuesdaySlot: ScheduleSlot = {
		dayOfWeek: 'tuesday',
		startTime: '16:00',
		endTime: '17:30',
		location: 'Library'
	};

	it('prefills the next occurrence of the club schedule when slots exist', () => {
		// Monday, Jan 5, 2026 -> next Tuesday is Jan 6.
		const now = new Date(2026, 0, 5).getTime();
		const result = buildDefaultSessionForm([tuesdaySlot], [], now);

		expect(new Date(result.startTime)).toEqual(new Date(2026, 0, 6, 16, 0));
		expect(new Date(result.endTime)).toEqual(new Date(2026, 0, 6, 17, 30));
		expect(result.location).toBe('Library');
		expect(result.description).toBe('');
	});

	it('skips past the latest existing session before picking the next slot date', () => {
		const now = new Date(2026, 0, 1).getTime();
		const lastSessionStart = new Date(2026, 0, 6, 16, 0).getTime(); // a Tuesday session already exists
		const result = buildDefaultSessionForm([tuesdaySlot], [lastSessionStart], now);

		// Next Tuesday strictly after Jan 6 is Jan 13.
		expect(new Date(result.startTime)).toEqual(new Date(2026, 0, 13, 16, 0));
	});

	it('falls back to now+1h/2h with no location when the club has no schedule slots', () => {
		const now = new Date(2026, 0, 5).getTime();
		const result = buildDefaultSessionForm([], [], now);

		expect(result.startTime).toBe(now + 3_600_000);
		expect(result.endTime).toBe(now + 7_200_000);
		expect(result.location).toBe('');
	});
});
