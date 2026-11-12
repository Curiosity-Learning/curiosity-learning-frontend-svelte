import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import { authClient } from '$lib/auth-client';
import { clearClientSessionArtifacts } from './onboarding-state';

const delay = (ms: number) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));

// Signs this device out and lands on the sign-in page. Shared by the profile menu, Settings'
// "Sign out everywhere", the child page's "Not your device?" banner and "Sign in again" (fresh
// sign-in for routing changes), and /verify-email's wrong-account case. Waits (briefly) until
// Better Auth no longer reports a session, so the sign-in page's signed-in redirect does not
// bounce straight back. `next`: an app path to continue to after signing in again.
export const signOutAndGoToSignIn = async (next?: string) => {
	clearClientSessionArtifacts();
	await authClient.signOut();
	for (let attempt = 0; attempt < 5; attempt += 1) {
		try {
			const session = await authClient.getSession({
				query: { disableCookieCache: true }
			});
			if (!session.data) break;
		} catch {
			break;
		}
		await delay(150);
	}
	const signInPath = resolve('/auth/sign-in');
	const target =
		next?.startsWith('/') && !next.startsWith('//')
			? `${signInPath}?next=${encodeURIComponent(next)}`
			: signInPath;
	await goto(target, { replaceState: true, invalidateAll: true });
};
