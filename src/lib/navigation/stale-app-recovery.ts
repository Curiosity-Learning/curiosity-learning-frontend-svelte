/**
 * Recovery for tabs that stay open across a deploy (CL-806, Sentry issues T and V).
 *
 * Every Vercel deploy replaces the hashed JS chunks under `/_app/immutable/`. A tab still
 * running the old build then fails as soon as it needs a chunk it has not loaded yet
 * ("Failed to fetch dynamically imported module" in Chromium, "Importing a module script
 * failed" in Safari). The fix is a full page load, which fetches the new build.
 *
 * - On a failed client navigation or hydration (client `handleError`), reload the target URL
 *   at most once per app version, so a chunk that is really broken cannot cause a loop.
 * - When only a background preload fails, the user may be typing, so we only mark the app
 *   as stale and do a full-page load on the next navigation instead. If the page never
 *   started (its entry chunks are gone), it is reloaded once right away.
 * - SvelteKit's `updated` poll (`kit.version.pollInterval`) also marks a new deploy; the
 *   next navigation then becomes a full-page load before any old chunk is requested.
 */

const STALE_CHUNK_ERROR_PATTERNS = [
	/Failed to fetch dynamically imported module/i, // Chromium
	/Importing a module script failed/i, // Safari
	/error loading dynamically imported module/i, // Firefox
	/Unable to preload CSS/i, // Vite preload helper
	/is not a valid JavaScript MIME type/i // a 404 HTML page served for a chunk
];

export const STALE_APP_RELOAD_KEY_PREFIX = 'cl_stale_app_reload:';

export const isStaleChunkError = (error: unknown): boolean => {
	const message =
		error instanceof Error
			? error.message
			: typeof error === 'string'
				? error
				: typeof error === 'object' && error !== null && 'message' in error
					? String((error as { message: unknown }).message)
					: '';
	return STALE_CHUNK_ERROR_PATTERNS.some((pattern) => pattern.test(message));
};

type ReloadDeps = {
	storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
	navigate?: (href: string) => void;
	online?: boolean;
};

const defaultStorage = () => {
	try {
		return typeof sessionStorage === 'undefined' ? null : sessionStorage;
	} catch {
		return null;
	}
};

/**
 * Full-page load of `url`, at most once per app version in this tab. Returns whether the
 * reload was started. Without sessionStorage (or offline) it never reloads, so it cannot loop.
 */
export const reloadOnceForStaleApp = (
	url: URL | string,
	version: string,
	{
		storage = defaultStorage(),
		navigate = (href) => window.location.assign(href),
		online = typeof navigator === 'undefined' ? true : navigator.onLine
	}: ReloadDeps = {}
): boolean => {
	// Offline, the chunk failed because there is no network; a reload would only show the
	// browser's offline page and lose what is on screen.
	if (!online || !storage) return false;

	const key = `${STALE_APP_RELOAD_KEY_PREFIX}${version}`;
	try {
		if (storage.getItem(key)) return false;
		storage.setItem(key, String(Date.now()));
	} catch {
		return false;
	}

	navigate(typeof url === 'string' ? url : url.href);
	return true;
};

let staleChunkSeen = false;
let appStarted = false;
const recoveredErrors = new WeakSet<object>();

/** The root layout mounted: SvelteKit started, so client navigations can recover. */
export const markAppStarted = () => {
	appStarted = true;
};

export const isAppMarkedStale = () => staleChunkSeen;

/**
 * A chunk failed to load outside a navigation (unhandled rejection or `vite:preloadError`).
 * - App running (e.g. a link preload failed): only remember it; the next navigation becomes a
 *   full-page load, so nothing reloads while the user is typing.
 * - App never started (the page's own entry chunks are gone, so it is dead): reload now, once
 *   per version.
 * Returns whether it was handled; handled errors are not sent to Sentry (`wasRecovered`).
 */
export const recoverFromStaleChunkOutsideNavigation = (
	reason: unknown,
	version: string,
	deps?: ReloadDeps
): boolean => {
	if (!isStaleChunkError(reason)) return false;

	let handled = true;
	if (appStarted) staleChunkSeen = true;
	else handled = reloadOnceForStaleApp(window.location.href, version, deps);

	if (handled && typeof reason === 'object' && reason !== null) recoveredErrors.add(reason);
	return handled;
};

export const wasRecovered = (error: unknown) =>
	typeof error === 'object' && error !== null && recoveredErrors.has(error);

/** Test helper. */
export const resetStaleAppState = () => {
	staleChunkSeen = false;
	appStarted = false;
};

type NavigationLike = {
	to: { url: URL } | null;
	willUnload: boolean;
	cancel: () => void;
};

/**
 * `beforeNavigate` handler: when a new deploy is known (`updated`) or a chunk already failed,
 * turn the client-side navigation into a full-page load of the same URL. This runs only when
 * the user navigates, so nothing reloads while they are typing.
 */
export const forceFullPageNavigationIfStale = (
	navigation: NavigationLike,
	updatedCurrent: boolean,
	{
		navigate = (href: string) => window.location.assign(href),
		currentOrigin = window.location.origin
	}: { navigate?: (href: string) => void; currentOrigin?: string } = {}
): boolean => {
	if (navigation.willUnload || !navigation.to?.url) return false;
	if (!updatedCurrent && !staleChunkSeen) return false;
	if (navigation.to.url.origin !== currentOrigin) return false;

	navigation.cancel();
	navigate(navigation.to.url.href);
	return true;
};
