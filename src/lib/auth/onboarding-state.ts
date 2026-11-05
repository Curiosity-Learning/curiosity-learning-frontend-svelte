const SIGNUP_DRAFT_STORAGE_KEY = 'cl_signup_draft_v1';
const POST_SIGNUP_PENDING_KEY = 'cl_post_signup_pending_v1';
const START_CLUB_DRAFT_STORAGE_KEY = 'cl_start_club_draft_v1';
export const LAST_CLUB_ID_STORAGE_KEY = 'cl_last_club_id';
// Set by /child/[id] when the visit arrived through a one-time sign-in link (`via=link`, see
// lib/auth/magic-link.ts): it shows a "Not your device? Sign out" banner for this tab (CL-769).
export const SIGNED_IN_VIA_LINK_STORAGE_KEY = 'cl_signed_in_via_link_v1';

export const clearOnboardingFlowState = () => {
	if (typeof window === 'undefined') return;
	try {
		window.sessionStorage.removeItem(SIGNUP_DRAFT_STORAGE_KEY);
		window.sessionStorage.removeItem(POST_SIGNUP_PENDING_KEY);
		window.sessionStorage.removeItem(START_CLUB_DRAFT_STORAGE_KEY);
	} catch {
		// Ignore storage errors.
	}
};

export const clearClientSessionArtifacts = () => {
	if (typeof window === 'undefined') return;
	clearOnboardingFlowState();
	try {
		window.localStorage.removeItem(LAST_CLUB_ID_STORAGE_KEY);
		window.sessionStorage.removeItem(SIGNED_IN_VIA_LINK_STORAGE_KEY);
	} catch {
		// Ignore storage errors.
	}
};
