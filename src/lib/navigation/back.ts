import { browser } from '$app/environment';
import { goto } from '$app/navigation';

const HISTORY_INDEX_KEY = 'sveltekit:history';

type NavigateBackOptions = {
	fallbackHref: string;
	replaceState?: boolean;
};

const getHistoryIndex = () => {
	if (!browser) return null;
	const value = window.history.state?.[HISTORY_INDEX_KEY];
	return typeof value === 'number' ? value : null;
};

const hasSameOriginReferrer = () => {
	if (!browser || !document.referrer) return false;
	try {
		return new URL(document.referrer).origin === window.location.origin;
	} catch {
		return false;
	}
};

const canUseInternalHistoryBack = () => {
	if (!browser || window.history.length <= 1) return false;
	const historyIndex = getHistoryIndex();
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
