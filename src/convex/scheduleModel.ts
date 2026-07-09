import { v } from 'convex/values';

export const DAYS_OF_WEEK = [
	'monday',
	'tuesday',
	'wednesday',
	'thursday',
	'friday',
	'saturday',
	'sunday'
] as const;

export type DayOfWeek = (typeof DAYS_OF_WEEK)[number];

export const dayOfWeekValidator = v.union(
	v.literal('monday'),
	v.literal('tuesday'),
	v.literal('wednesday'),
	v.literal('thursday'),
	v.literal('friday'),
	v.literal('saturday'),
	v.literal('sunday')
);

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const isValidTimeString = (value: string): boolean => TIME_PATTERN.test(value);

const timeToMinutes = (value: string): number => {
	const [hours, minutes] = value.split(':').map((part) => Number.parseInt(part, 10));
	return hours * 60 + minutes;
};

export const isEndTimeAfterStartTime = (startTime: string, endTime: string): boolean =>
	timeToMinutes(endTime) > timeToMinutes(startTime);
