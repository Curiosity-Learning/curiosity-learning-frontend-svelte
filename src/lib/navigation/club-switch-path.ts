/**
 * Maps a pathname within one club's dashboard to the equivalent pathname for
 * another club, preserving the current sub-view (sessions/projects/members/etc.)
 * when possible. Falls back to the target club's dashboard root otherwise.
 *
 * Only club-generic sub-views are preserved. Deeper paths (e.g. a specific
 * session or project detail) reference entities that belong to the previous
 * club, so carrying them across would produce broken URLs.
 *
 * Examples:
 *   /club/A/sessions          -> /club/B/sessions
 *   /club/A/projects/current  -> /club/B/projects/current
 *   /club/A/sessions/xyz      -> /club/B
 *   /club/A                   -> /club/B
 */
const CLUB_GENERIC_SUB_VIEWS = [
	'/sessions',
	'/members',
	'/settings',
	'/projects/current',
	'/projects/completed'
];

export const buildClubSwitchPath = (
	pathname: string,
	fromClubId: string,
	toClubId: string
): string => {
	const prefix = `/club/${fromClubId}`;
	if (pathname.startsWith(`${prefix}/`)) {
		const rest = pathname.slice(prefix.length);
		if (CLUB_GENERIC_SUB_VIEWS.includes(rest)) {
			return `/club/${toClubId}${rest}`;
		}
	}
	// Club root, an entity-specific drill-down, or not a club-scoped path —
	// go to the target club's dashboard root rather than guessing.
	return `/club/${toClubId}`;
};
