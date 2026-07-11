import type { Doc } from '$convex/_generated/dataModel';

export type SessionBucket = 'Today' | 'Tomorrow' | 'Upcoming' | 'Past';

const HOUR_MS = 60 * 60 * 1000;

// Client-side mirrors of the windows enforced in src/convex/sessions.ts (ATTENDANCE_LOCK_WINDOW_MS
// and SESSION_PHOTO_POST_SESSION_WINDOW_MS) — keep the values in sync with the server.
export const ATTENDANCE_LOCK_WINDOW_MS = 12 * HOUR_MS;
export const SESSION_PHOTO_UPLOAD_WINDOW_MS = 12 * HOUR_MS;

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

export const formatSessionHeaderLine = (timestamp: number) => {
	const date = new Date(timestamp);
	const weekday = date.toLocaleDateString(undefined, { weekday: 'short' });
	const monthDay = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
	const time = date
		.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
		.replace('AM', 'am')
		.replace('PM', 'pm');
	return `${weekday}, ${monthDay}, ${time}`;
};
