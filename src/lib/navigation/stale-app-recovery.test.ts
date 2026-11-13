import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	STALE_APP_RELOAD_KEY_PREFIX,
	forceFullPageNavigationIfStale,
	isStaleChunkError,
	markAppStale,
	reloadOnceForStaleApp,
	resetStaleAppState
} from './stale-app-recovery';

const memoryStorage = () => {
	const items = new Map<string, string>();
	return {
		getItem: (key: string) => items.get(key) ?? null,
		setItem: (key: string, value: string) => void items.set(key, value),
		items
	};
};

describe('isStaleChunkError', () => {
	it('matches the browser messages for a missing chunk', () => {
		expect(
			isStaleChunkError(
				new TypeError(
					'Failed to fetch dynamically imported module: https://clubs.curiositylearning.org/_app/immutable/nodes/62.BuzJ45Ha.js'
				)
			)
		).toBe(true);
		expect(isStaleChunkError(new TypeError('Importing a module script failed.'))).toBe(true);
		expect(isStaleChunkError('error loading dynamically imported module: /x.js')).toBe(true);
		expect(isStaleChunkError({ message: 'Unable to preload CSS for /_app/a.css' })).toBe(true);
	});

	it('ignores other errors', () => {
		expect(isStaleChunkError(new Error('Network request failed'))).toBe(false);
		expect(isStaleChunkError(undefined)).toBe(false);
		expect(isStaleChunkError(null)).toBe(false);
	});
});

describe('reloadOnceForStaleApp', () => {
	it('reloads once per version, then refuses so it cannot loop', () => {
		const storage = memoryStorage();
		const navigate = vi.fn();
		const url = new URL('https://clubs.example/onboarding/start-club');

		expect(reloadOnceForStaleApp(url, 'v1', { storage, navigate, online: true })).toBe(true);
		expect(navigate).toHaveBeenCalledWith(url.href);
		expect(storage.items.has(`${STALE_APP_RELOAD_KEY_PREFIX}v1`)).toBe(true);

		expect(reloadOnceForStaleApp(url, 'v1', { storage, navigate, online: true })).toBe(false);
		expect(navigate).toHaveBeenCalledTimes(1);

		// A later deploy gets its own single reload.
		expect(reloadOnceForStaleApp(url, 'v2', { storage, navigate, online: true })).toBe(true);
		expect(navigate).toHaveBeenCalledTimes(2);
	});

	it('does not reload offline or without storage', () => {
		const navigate = vi.fn();
		expect(
			reloadOnceForStaleApp('https://x/', 'v1', {
				storage: memoryStorage(),
				navigate,
				online: false
			})
		).toBe(false);
		expect(
			reloadOnceForStaleApp('https://x/', 'v1', { storage: null, navigate, online: true })
		).toBe(false);
		const throwing = {
			getItem: () => null,
			setItem: () => {
				throw new Error('QuotaExceededError');
			}
		};
		expect(
			reloadOnceForStaleApp('https://x/', 'v1', { storage: throwing, navigate, online: true })
		).toBe(false);
		expect(navigate).not.toHaveBeenCalled();
	});
});

describe('forceFullPageNavigationIfStale', () => {
	afterEach(() => resetStaleAppState());

	const nav = (href: string | null, willUnload = false) => ({
		to: href ? { url: new URL(href) } : null,
		willUnload,
		cancel: vi.fn()
	});
	const currentOrigin = 'https://clubs.example';

	it('leaves navigation alone while the app is current', () => {
		const navigate = vi.fn();
		const navigation = nav('https://clubs.example/feed');
		expect(forceFullPageNavigationIfStale(navigation, false, { navigate, currentOrigin })).toBe(
			false
		);
		expect(navigation.cancel).not.toHaveBeenCalled();
		expect(navigate).not.toHaveBeenCalled();
	});

	it('turns the navigation into a full-page load after a new deploy is detected', () => {
		const navigate = vi.fn();
		const navigation = nav('https://clubs.example/feed?tab=1');
		expect(forceFullPageNavigationIfStale(navigation, true, { navigate, currentOrigin })).toBe(
			true
		);
		expect(navigation.cancel).toHaveBeenCalled();
		expect(navigate).toHaveBeenCalledWith('https://clubs.example/feed?tab=1');
	});

	it('does the same after a chunk preload failed', () => {
		markAppStale();
		const navigate = vi.fn();
		expect(
			forceFullPageNavigationIfStale(nav('https://clubs.example/feed'), false, {
				navigate,
				currentOrigin
			})
		).toBe(true);
		expect(navigate).toHaveBeenCalledOnce();
	});

	it('ignores unloads and other origins', () => {
		const navigate = vi.fn();
		expect(
			forceFullPageNavigationIfStale(nav('https://clubs.example/feed', true), true, {
				navigate,
				currentOrigin
			})
		).toBe(false);
		expect(
			forceFullPageNavigationIfStale(nav('https://other.example/'), true, {
				navigate,
				currentOrigin
			})
		).toBe(false);
		expect(forceFullPageNavigationIfStale(nav(null), true, { navigate, currentOrigin })).toBe(
			false
		);
		expect(navigate).not.toHaveBeenCalled();
	});
});
