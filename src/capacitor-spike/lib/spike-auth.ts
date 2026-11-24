// CL-819 spike: the native app's Better Auth client. It talks to the Convex site directly (there
// is no SvelteKit server in the bundled app), carrying the session in a Better-Auth-Cookie header
// held by the crossDomain client in a Keychain/Keystore-backed synchronous cache.

import { Capacitor } from '@capacitor/core';
import { createAuthClient } from 'better-auth/client';
import { magicLinkClient, usernameClient } from 'better-auth/client/plugins';
import { convexClient, crossDomainClient } from '@convex-dev/better-auth/client/plugins';
import {
	createMemorySecureStore,
	createSyncStorageCache,
	type AsyncSecureStore,
	type SyncStorageCache
} from './secure-storage-cache';

// crossDomainClient's keys: `${storagePrefix}_cookie` and `${storagePrefix}_session_data`.
export const STORAGE_PREFIX = 'better-auth';
export const SPIKE_STORAGE_KEYS = [`${STORAGE_PREFIX}_cookie`, `${STORAGE_PREFIX}_session_data`];

const nativeSecureStore = async (): Promise<AsyncSecureStore> => {
	const { SecureStorage, KeychainAccess } = await import('@aparajita/capacitor-secure-storage');
	await SecureStorage.setKeyPrefix('cl_spike_');
	// Never in iCloud Keychain, never restored to another device, readable after first unlock so
	// a background relaunch still finds the session.
	await SecureStorage.setSynchronize(false);
	await SecureStorage.setDefaultKeychainAccess(KeychainAccess.afterFirstUnlockThisDeviceOnly);
	return {
		getItem: (key) => SecureStorage.getItem(key),
		setItem: (key, value) => SecureStorage.setItem(key, value),
		removeItem: async (key) => {
			await SecureStorage.removeItem(key);
		}
	};
};

export type SpikeAuth = {
	authClient: ReturnType<typeof buildAuthClient>;
	storage: SyncStorageCache;
	backend:
		| 'keychain/keystore'
		| 'memory (browser preview)'
		| 'memory (KEYCHAIN/KEYSTORE SETUP FAILED: nothing persists)';
	siteUrl: string;
};

const buildAuthClient = (siteUrl: string, storage: SyncStorageCache) =>
	createAuthClient({
		baseURL: siteUrl,
		plugins: [
			convexClient(),
			crossDomainClient({ storage, storagePrefix: STORAGE_PREFIX }),
			magicLinkClient(),
			usernameClient()
		]
	});

/**
 * Builds the auth client after the cache is hydrated, so the very first request is signed in.
 * Keychain/Keystore failures (setup, reads, writes) go to onStorageError for the phone UI.
 */
export const createSpikeAuth = async (
	siteUrl: string,
	onStorageError?: (error: unknown) => void
): Promise<SpikeAuth> => {
	let store: AsyncSecureStore = createMemorySecureStore();
	let backend: SpikeAuth['backend'] = 'memory (browser preview)';
	if (Capacitor.isNativePlatform()) {
		try {
			store = await nativeSecureStore();
			backend = 'keychain/keystore';
		} catch (error) {
			onStorageError?.(error);
			backend = 'memory (KEYCHAIN/KEYSTORE SETUP FAILED: nothing persists)';
		}
	}
	const storage = createSyncStorageCache(store, SPIKE_STORAGE_KEYS, { onError: onStorageError });
	await storage.hydrate();
	return { authClient: buildAuthClient(siteUrl, storage), storage, backend, siteUrl };
};

/** A Convex JWT for the current session (null when signed out). */
export const fetchConvexToken = async (auth: SpikeAuth): Promise<string | null> => {
	const { data } = await auth.authClient.$fetch<{ token: string }>('/convex/token', {
		method: 'GET'
	});
	return data?.token ?? null;
};
