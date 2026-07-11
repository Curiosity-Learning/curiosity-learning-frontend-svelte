import { browser } from '$app/environment';
import { goto } from '$app/navigation';

const HISTORY_INDEX_KEY = 'sveltekit:history';

type NavigateBackOptions = {
	fallbackHref: string;
	replaceState?: boolean;
};

type InternalHistoryBackOptions = {
	initialHistoryIndex?: number | null;
};

const getHistoryIndex = () => {
	if (!browser) return null;
	const value = window.history.state?.[HISTORY_INDEX_KEY];
	return typeof value === 'number' ? value : null;
};

const getReferrerOrigin = () => {
	if (!browser || !document.referrer) return null;
	try {
		return new URL(document.referrer).origin;
	} catch {
		return null;
	}
};

const hasSameOriginReferrer = () => {
	return getReferrerOrigin() === window.location.origin;
};

const hasExternalReferrer = () => {
	const referrerOrigin = getReferrerOrigin();
	return Boolean(referrerOrigin && referrerOrigin !== window.location.origin);
};

export const canUseInternalHistoryBack = ({
	initialHistoryIndex = null
}: InternalHistoryBackOptions = {}) => {
	if (!browser || window.history.length <= 1) return false;
	const historyIndex = getHistoryIndex();
	if (initialHistoryIndex !== null && historyIndex !== null) {
		return historyIndex > initialHistoryIndex;
	}
	if (hasExternalReferrer()) return false;
	if (historyIndex !== null) {
		return historyIndex > 0;
	}
	return hasSameOriginReferrer();
};

export const navigateBack = async ({ fallbackHref, replaceState }: NavigateBackOptions) => {
	if (canUseInternalHistoryBack()) {
		window.history.back();
		return;
	}

	await goto(fallbackHref, { replaceState });
};

// ── Post club-switch back guard ───────────────────────────────────────────
//
// The club switcher replaces the current history entry (see club-switcher.svelte)
// so the switch itself never leaves a stale "old club" entry to browse back into.
// That alone isn't enough: if the user had navigated a few steps *within* the old
// club before switching (e.g. dashboard -> sessions), the entries below the
// replaced one still point at the old club, and a plain `window.history.back()`
// would surface them.
//
// To guarantee "back right after a switch always lands on the new club's home"
// (not "somewhere in the old club"), we mark the path the switch navigated to.
// The in-app back button (see app-shell.svelte's handleBack) checks this marker:
// if the user is still on that exact path, it prefers the page's fallbackHref
// (the current club's home) instead of history.back(). The marker is consumed
// on first use, and also auto-expires the moment the user navigates anywhere
// else first (see the effect in app-shell.svelte), so normal history-based back
// behavior resumes for any navigation that isn't the immediate post-switch one.
let pendingClubSwitchPath: string | null = null;

export const markClubSwitchTarget = (path: string) => {
	pendingClubSwitchPath = path;
};

export const shouldPreferFallbackAfterClubSwitch = (currentPath: string) =>
	pendingClubSwitchPath !== null && pendingClubSwitchPath === currentPath;

export const consumeClubSwitchTarget = () => {
	pendingClubSwitchPath = null;
};

export const clearClubSwitchTargetIfPathChanged = (currentPath: string) => {
	if (pendingClubSwitchPath !== null && pendingClubSwitchPath !== currentPath) {
		pendingClubSwitchPath = null;
	}
};
