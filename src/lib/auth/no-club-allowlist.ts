import { routes } from '$lib/routes';

// PRD 2.4/6.1.10 (CL-703): a club-less user must still be able to reach a small set of routes —
// Settings/Profile/Notifications (account-level, not club-scoped), /no-club and /new-club
// (onboarding itself), /child (the entry point into a parent's "View as Child", CL-801, which
// never requires the PARENT to have a club), and /chat (CL-710 CEO review item 1: a start-club or join-request
// applicant is, by definition, club-less — without this, their "Open chat" button on the no-club
// page got silently redirected right back to /new-club instead of opening the
// interview/application chat) — see CL-690's original no-club allowlist that this extends, and
// /applications (a start-club applicant is club-less by definition, and must be able to open their
// own application's detail page from the chat context banner / no-club card), and /verify-email
// (a child confirming the notification email a parent added, CL-768 — the link must work whether
// or not the child is in a club yet). Shared by
// `(app)/+layout.server.ts` (SSR redirect-to-/new-club gate) and `(app)/+layout.svelte`
// (client-side navigation effect with the same job) so the two can't drift out of sync with each
// other.
export const noClubAllowedPaths = [
	routes.noClub,
	routes.newClub,
	routes.profile,
	routes.settings,
	routes.notifications,
	routes.child,
	routes.chat,
	routes.applications,
	routes.verifyEmail
];

// A path is "allowed without a club" if it IS one of the above, or is nested under one of them
// (e.g. `/settings/media-upload-dev`, `/profile/:id`, `/child/:childProfileId`).
export const isNoClubAllowedPath = (pathname: string) =>
	noClubAllowedPaths.some(
		(allowedPath) => pathname === allowedPath || pathname.startsWith(`${allowedPath}/`)
	);

// Edge case 14: where a club-less account goes instead of a club. A parent account exists to
// follow a child, not to start a club, so an account linked to a child (parentAccounts
// .getMyFirstLinkedChildId) lands on Settings: the "View as" bar above it opens the child's view,
// and the children's email settings are on the page. Not into the view itself (CL-801): "Back to
// my account" goes to `/`, which would land a club-less parent straight back in it. Everyone else
// goes to /new-club. Shared by `/`, `/club` and both (app) layout gates.
export const clubLessLandingPath = (firstLinkedChildId: string | null | undefined) =>
	firstLinkedChildId ? routes.settings : routes.newClub;
