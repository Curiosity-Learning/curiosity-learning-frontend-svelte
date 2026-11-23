// CL-819 spike: a synchronous storage facade over an asynchronous secure store.
//
// crossDomainClient({ storage }) calls storage.getItem() synchronously (inside fetch hooks and
// getCookie()), but Keychain/Keystore access through @aparajita/capacitor-secure-storage is
// asynchronous. So: load the few keys we own into memory once at startup (hydrate), answer reads
// from memory, and write every change through to the secure store. @capacitor/preferences is
// deliberately not used anywhere: it is plaintext UserDefaults/SharedPreferences.

/** The subset of @aparajita/capacitor-secure-storage this cache needs (also easy to fake). */
export type AsyncSecureStore = {
	getItem(key: string): Promise<string | null>;
	setItem(key: string, value: string): Promise<void>;
	removeItem(key: string): Promise<void>;
};

export type SyncStorageCache = {
	/** Loads `keys` from the secure store into memory. Await before the auth client's first use. */
	hydrate(): Promise<void>;
	readonly hydrated: boolean;
	getItem(key: string): string | null;
	/** Updates memory immediately; the returned promise settles when the secure store has it. */
	setItem(key: string, value: string): Promise<void>;
	removeItem(key: string): Promise<void>;
	/** Resolves once every write issued so far has reached the secure store. */
	flush(): Promise<void>;
	/** Keys present in memory, for the diagnostics panel. */
	keys(): string[];
	/** The last secure-store failure, if any (surfaced in the spike UI, never thrown at callers). */
	readonly lastError: unknown;
};

export const createSyncStorageCache = (
	store: AsyncSecureStore,
	keys: readonly string[]
): SyncStorageCache => {
	const memory = new Map<string, string>();
	let hydrated = false;
	let lastError: unknown = null;
	// Writes are chained so the secure store sees them in the order the client made them (a
	// sign-in's set followed by a sign-out's clear must not land the other way round).
	let queue: Promise<void> = Promise.resolve();

	const enqueue = (write: () => Promise<void>) => {
		queue = queue.then(write).catch((error: unknown) => {
			lastError = error;
		});
		return queue;
	};

	return {
		async hydrate() {
			const entries = await Promise.all(
				keys.map(async (key) => {
					try {
						return [key, await store.getItem(key)] as const;
					} catch (error) {
						lastError = error;
						return [key, null] as const;
					}
				})
			);
			for (const [key, value] of entries) {
				// A write made before hydrate finished is newer than what the store had.
				if (value !== null && !memory.has(key)) memory.set(key, value);
			}
			hydrated = true;
		},
		get hydrated() {
			return hydrated;
		},
		getItem(key) {
			return memory.get(key) ?? null;
		},
		setItem(key, value) {
			memory.set(key, value);
			return enqueue(() => store.setItem(key, value));
		},
		removeItem(key) {
			memory.delete(key);
			return enqueue(() => store.removeItem(key));
		},
		flush() {
			return queue;
		},
		keys() {
			return [...memory.keys()];
		},
		get lastError() {
			return lastError;
		}
	};
};

/** In-memory stand-in for tests and the plain-browser preview (persists nothing). */
export const createMemorySecureStore = (
	initial: Record<string, string> = {}
): AsyncSecureStore & { snapshot(): Record<string, string> } => {
	const data = new Map(Object.entries(initial));
	return {
		async getItem(key) {
			return data.get(key) ?? null;
		},
		async setItem(key, value) {
			data.set(key, value);
		},
		async removeItem(key) {
			data.delete(key);
		},
		snapshot() {
			return Object.fromEntries(data);
		}
	};
};
