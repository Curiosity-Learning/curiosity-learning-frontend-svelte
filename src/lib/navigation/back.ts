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
