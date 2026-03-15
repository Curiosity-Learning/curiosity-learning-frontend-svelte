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

const pluralizeWeekday = (value: string | null | undefined) => {
	if (!value) return '';
	const day = value.trim();
	if (!day) return '';
	return day.endsWith('s') ? day : `${day}s`;
};

export const formatMeetingTime = (value: string | null | undefined) => {
	if (!value) return '';
	const raw = value.trim();
	if (!raw) return '';

	const hhmmMatch = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(raw);
	if (hhmmMatch) {
		const hours24 = Number.parseInt(hhmmMatch[1], 10);
		const minutes = hhmmMatch[2];
		const meridiem = hours24 >= 12 ? 'pm' : 'am';
		const hours12 = hours24 % 12 || 12;
		return `${hours12}:${minutes} ${meridiem}`;
	}

	const twelveHourMatch = /^(0?[1-9]|1[0-2]):([0-5]\d)\s*([ap]m)$/i.exec(raw);
	if (twelveHourMatch) {
		const hours = Number.parseInt(twelveHourMatch[1], 10);
		const minutes = twelveHourMatch[2];
		const meridiem = twelveHourMatch[3].toLowerCase();
		return `${hours}:${minutes} ${meridiem}`;
	}

	return raw;
};

export const formatWeeklyMeetingLabel = (
	day: string | null | undefined,
	time: string | null | undefined
) => {
	const formattedDay = pluralizeWeekday(day);
	const formattedTime = formatMeetingTime(time);

	if (formattedDay && formattedTime) {
		return `${formattedDay} at ${formattedTime}`;
	}

	return formattedDay || formattedTime;
};
