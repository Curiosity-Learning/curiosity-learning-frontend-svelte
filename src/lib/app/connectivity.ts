import { browser } from '$app/environment';
import { derived, readable, writable } from 'svelte/store';

const mutationConnectivityHealthy = writable(true);

export const browserOnline = readable(true, (set) => {
	if (!browser) {
		set(true);
		return;
	}

	const syncOnlineState = () => set(navigator.onLine);
	const handleOnline = () => {
		set(true);
		mutationConnectivityHealthy.set(true);
	};
	const handleOffline = () => set(false);

	syncOnlineState();
	window.addEventListener('online', handleOnline);
	window.addEventListener('offline', handleOffline);

	return () => {
		window.removeEventListener('online', handleOnline);
		window.removeEventListener('offline', handleOffline);
	};
});

export const canMutateOnline = derived(
	[browserOnline, mutationConnectivityHealthy],
	([$browserOnline, $mutationConnectivityHealthy]) => $browserOnline && $mutationConnectivityHealthy
);

export const connectivityMessage = derived(browserOnline, ($browserOnline) =>
	$browserOnline
		? 'Editing is temporarily disabled because the server cannot be reached.'
		: 'Editing is disabled while offline. Reconnect to continue.'
);

export const isConnectivityError = (error: unknown) => {
	if (!error) return false;
	if (error instanceof TypeError) return true;

	const message =
		error instanceof Error
			? error.message.toLowerCase()
			: typeof error === 'string'
				? error.toLowerCase()
				: '';

	return (
		message.includes('failed to fetch') ||
		message.includes('fetch failed') ||
		message.includes('network') ||
		message.includes('offline') ||
		message.includes('connection') ||
		message.includes('timed out')
	);
};

export const reportMutationSuccess = () => {
	mutationConnectivityHealthy.set(true);
};

export const reportMutationFailure = (error: unknown) => {
	if (isConnectivityError(error)) {
		mutationConnectivityHealthy.set(false);
	}
};
