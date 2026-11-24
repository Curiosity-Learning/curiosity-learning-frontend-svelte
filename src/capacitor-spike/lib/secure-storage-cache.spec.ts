import { describe, expect, it } from 'vitest';
import {
	createMemorySecureStore,
	createSyncStorageCache,
	type AsyncSecureStore
} from './secure-storage-cache';

const KEYS = ['better-auth_cookie', 'better-auth_session_data'];

describe('createSyncStorageCache (CL-819)', () => {
	it('hydrates the known keys from the secure store and answers reads synchronously', async () => {
		const store = createMemorySecureStore({
			'better-auth_cookie': '{"a":1}',
			'unrelated-key': 'not loaded'
		});
		const cache = createSyncStorageCache(store, KEYS);
		expect(cache.hydrated).toBe(false);
		expect(cache.getItem('better-auth_cookie')).toBeNull();

		await cache.hydrate();

		expect(cache.hydrated).toBe(true);
		const read: string | null = cache.getItem('better-auth_cookie');
		expect(read).toBe('{"a":1}');
		expect(cache.getItem('better-auth_session_data')).toBeNull();
		expect(cache.getItem('unrelated-key')).toBeNull();
		expect(cache.keys()).toEqual(['better-auth_cookie']);
	});

	it('writes through: memory updates at once, the secure store after flush', async () => {
		const store = createMemorySecureStore();
		const cache = createSyncStorageCache(store, KEYS);
		await cache.hydrate();

		void cache.setItem('better-auth_cookie', 'v1');
		expect(cache.getItem('better-auth_cookie')).toBe('v1');
		await cache.flush();
		expect(store.snapshot()).toEqual({ 'better-auth_cookie': 'v1' });

		void cache.removeItem('better-auth_cookie');
		expect(cache.getItem('better-auth_cookie')).toBeNull();
		await cache.flush();
		expect(store.snapshot()).toEqual({});
	});

	it('keeps write order even when the secure store answers out of order', async () => {
		const writes: string[] = [];
		const slowFirst: AsyncSecureStore = {
			getItem: async () => null,
			setItem: async (key, value) => {
				await new Promise((resolve) => setTimeout(resolve, value === 'first' ? 20 : 0));
				writes.push(`set ${value}`);
			},
			removeItem: async () => {
				writes.push('remove');
			}
		};
		const cache = createSyncStorageCache(slowFirst, KEYS);
		void cache.setItem('better-auth_cookie', 'first');
		void cache.setItem('better-auth_cookie', 'second');
		void cache.removeItem('better-auth_cookie');
		await cache.flush();
		expect(writes).toEqual(['set first', 'set second', 'remove']);
	});

	it('survives an app restart: a fresh cache over the same store sees the session', async () => {
		const store = createMemorySecureStore();
		const first = createSyncStorageCache(store, KEYS);
		await first.hydrate();
		await first.setItem('better-auth_cookie', '{"better-auth.session_token":{"value":"t"}}');

		// "Kill" the app: the in-memory cache is gone, only the Keychain/Keystore remains.
		const relaunched = createSyncStorageCache(store, KEYS);
		await relaunched.hydrate();
		expect(relaunched.getItem('better-auth_cookie')).toContain('session_token');
	});

	it('does not let a slow hydrate overwrite a write made meanwhile', async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => (release = resolve));
		const store: AsyncSecureStore = {
			getItem: async () => {
				await gate;
				return 'stale';
			},
			setItem: async () => {},
			removeItem: async () => {}
		};
		const cache = createSyncStorageCache(store, KEYS);
		const hydrating = cache.hydrate();
		void cache.setItem('better-auth_cookie', 'fresh');
		release();
		await hydrating;
		expect(cache.getItem('better-auth_cookie')).toBe('fresh');
	});

	it('records secure-store failures instead of throwing into the auth client', async () => {
		const failing: AsyncSecureStore = {
			getItem: async () => {
				throw new Error('keychain locked');
			},
			setItem: async () => {
				throw new Error('keychain locked');
			},
			removeItem: async () => {}
		};
		const reported: unknown[] = [];
		const cache = createSyncStorageCache(failing, KEYS, {
			onError: (error) => reported.push(error)
		});
		await cache.hydrate();
		expect(cache.hydrated).toBe(true);
		await cache.setItem('better-auth_cookie', 'v');
		expect(cache.getItem('better-auth_cookie')).toBe('v');
		expect(String(cache.lastError)).toContain('keychain locked');
		// Two failed reads at hydrate, one failed write: each reaches the phone UI.
		expect(reported).toHaveLength(3);
	});
});
