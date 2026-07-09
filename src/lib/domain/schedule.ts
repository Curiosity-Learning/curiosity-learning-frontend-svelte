export type DayOfWeek =
	| 'monday'
	| 'tuesday'
	| 'wednesday'
	| 'thursday'
	| 'friday'
	| 'saturday'
	| 'sunday';

export type ScheduleSlot = {
	dayOfWeek: DayOfWeek;
	startTime: string;
	endTime: string;
	location: string;
};

const DAY_ORDER: DayOfWeek[] = [
	'sunday',
	'monday',
	'tuesday',
	'wednesday',
	'thursday',
	'friday',
	'saturday'
];

const DAY_LABELS: Record<DayOfWeek, string> = {
	monday: 'Monday',
	tuesday: 'Tuesday',
	wednesday: 'Wednesday',
	thursday: 'Thursday',
	friday: 'Friday',
	saturday: 'Saturday',
	sunday: 'Sunday'
};

export const dayOfWeekLabel = (day: DayOfWeek): string => DAY_LABELS[day];

export const pluralizedDayOfWeekLabel = (day: DayOfWeek): string => `${DAY_LABELS[day]}s`;

/**
 * Formats a schedule slot for display, e.g. "Tuesdays 16:00–17:30 · Library".
 */
export const formatScheduleSlot = (slot: ScheduleSlot): string => {
	const dayLabel = pluralizedDayOfWeekLabel(slot.dayOfWeek);
	const timeRange = `${slot.startTime}–${slot.endTime}`;
	return slot.location ? `${dayLabel} ${timeRange} · ${slot.location}` : `${dayLabel} ${timeRange}`;
};

const normalizeToLocalMidnight = (date: Date): Date =>
	new Date(date.getFullYear(), date.getMonth(), date.getDate());

/**
 * Returns the next calendar date (at local midnight) on which `dayOfWeek`
 * occurs, strictly after `after`. If `after` itself falls on `dayOfWeek`,
 * the result is 7 days later (the *next* occurrence, not the same day).
 */
export const nextOccurrenceOfDay = (dayOfWeek: DayOfWeek, after: Date): Date => {
	const targetIndex = DAY_ORDER.indexOf(dayOfWeek);
	const base = normalizeToLocalMidnight(after);
	const baseIndex = base.getDay();

	let daysUntil = (targetIndex - baseIndex + 7) % 7;
	if (daysUntil === 0) {
		daysUntil = 7;
	}

	const result = new Date(base);
	result.setDate(result.getDate() + daysUntil);
	return result;
};

/**
 * Given a club's schedule slots and the start time of the last planned
 * session (or null if there is none), picks the slot/date combination for
 * the next occurring session: the earliest date, strictly after the later
 * of `lastSessionStart` and `now`, on which any slot's day of week occurs.
 *
 * Returns null if there are no slots.
 */
export const nextScheduledSession = (
	slots: ScheduleSlot[],
	now: Date,
	lastSessionStart: Date | null
): { date: Date; slot: ScheduleSlot } | null => {
	if (slots.length === 0) {
		return null;
	}

	const after = lastSessionStart && lastSessionStart > now ? lastSessionStart : now;

	let best: { date: Date; slot: ScheduleSlot } | null = null;
	for (const slot of slots) {
		const date = nextOccurrenceOfDay(slot.dayOfWeek, after);
		if (!best || date < best.date) {
			best = { date, slot };
		}
	}

	return best;
};

/**
 * Combines a calendar date (local midnight) with an "HH:MM" time string
 * into a millisecond timestamp.
 */
export const combineDateAndTime = (date: Date, time: string): number => {
	const [hours, minutes] = time.split(':').map((part) => Number.parseInt(part, 10));
	return new Date(
		date.getFullYear(),
		date.getMonth(),
		date.getDate(),
		hours || 0,
		minutes || 0,
		0,
		0
	).getTime();
};
