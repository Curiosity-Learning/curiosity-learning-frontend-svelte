import type { Doc } from '$convex/_generated/dataModel';

export type SessionBucket = 'Today' | 'Tomorrow' | 'Upcoming' | 'Past';

const normalizeDate = (value: number) => {
	const date = new Date(value);
	return new Date(date.getFullYear(), date.getMonth(), date.getDate());
};

export const groupSessionsByBucket = (sessions: Array<Doc<'sessions'>>) => {
	const now = new Date();
	const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const tomorrow = new Date(today);
	tomorrow.setDate(tomorrow.getDate() + 1);

	const grouped: Record<SessionBucket, Array<Doc<'sessions'>>> = {
		Today: [],
		Tomorrow: [],
		Upcoming: [],
		Past: []
	};

	for (const session of sessions) {
		const day = normalizeDate(session.startTime);
		if (day.getTime() === today.getTime()) {
			grouped.Today.push(session);
			continue;
		}
		if (day.getTime() === tomorrow.getTime()) {
			grouped.Tomorrow.push(session);
			continue;
		}
		if (day.getTime() > tomorrow.getTime()) {
			grouped.Upcoming.push(session);
			continue;
		}
		grouped.Past.push(session);
	}

	return grouped;
};
