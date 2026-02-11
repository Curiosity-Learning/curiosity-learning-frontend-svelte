import type { ConvexClient } from 'convex/browser';
import { writable } from 'svelte/store';

// Shared client-side initialization gates.
// We keep these module-singletons so any page/layout can depend on them without
// duplicating work or creating race conditions.

export const profileReady = writable(false);

let ensureProfilePromise: Promise<void> | null = null;
let currentUserId: string | null = null;

export const setProfileInitUser = (userId: string | null) => {
	// Reset when the authenticated user changes (including sign-out).
	if (currentUserId !== userId) {
		currentUserId = userId;
		ensureProfilePromise = null;
		profileReady.set(false);
	}
};

export const resetProfileInit = () => setProfileInitUser(null);

type EnsureProfileApi = {
	auth: {
		ensureProfile: unknown;
	};
};

export const ensureProfileOnce = async (convexClient: ConvexClient, api: EnsureProfileApi) => {
	if (!currentUserId) {
		// Callers should set the active user via setProfileInitUser first.
		throw new Error('ensureProfileOnce called without an active user');
	}
	if (ensureProfilePromise) return ensureProfilePromise;
	ensureProfilePromise = (async () => {
		try {
			await convexClient.mutation(api.auth.ensureProfile as any, {} as any);
			profileReady.set(true);
		} catch (error) {
			// Allow retries: a transient auth/network error should not brick the app.
			ensureProfilePromise = null;
			profileReady.set(false);
			throw error;
		}
	})();
	return ensureProfilePromise;
};
