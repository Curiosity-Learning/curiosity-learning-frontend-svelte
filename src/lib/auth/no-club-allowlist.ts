import { routes } from '$lib/routes';

// PRD 2.4/6.1.10 (CL-703): a club-less user must still be able to reach a small set of routes —
// Settings/Profile/Notifications (account-level, not club-scoped), /no-club and /new-club
// (onboarding itself), /child (a parent's read-only "View as Child" surface, which never requires
// the PARENT to have a club), and /chat (CL-710 CEO review item 1: a start-club or join-request
// applicant is, by definition, club-less — without this, their "Open chat" button on the no-club
// page got silently redirected right back to /new-club instead of opening the
// interview/application chat) — see CL-690's original no-club allowlist that this extends. Shared
// by `(app)/+layout.server.ts` (SSR redirect-to-/new-club gate) and `(app)/+layout.svelte`
// (client-side navigation effect with the same job) so the two can't drift out of sync with each
// other.
export const noClubAllowedPaths = [
	routes.noClub,
	routes.newClub,
	routes.profile,
	routes.settings,
	routes.notifications,
	routes.child,
	routes.chat
];

// A path is "allowed without a club" if it IS one of the above, or is nested under one of them
// (e.g. `/settings/media-upload-dev`, `/profile/:id`, `/child/:childProfileId`).
export const isNoClubAllowedPath = (pathname: string) =>
	noClubAllowedPaths.some(
		(allowedPath) => pathname === allowedPath || pathname.startsWith(`${allowedPath}/`)
	);
