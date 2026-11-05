import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import { authClient } from '$lib/auth-client';
import { clearClientSessionArtifacts } from './onboarding-state';

const delay = (ms: number) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));

// Signs this device out and lands on the sign-in page. Shared by the profile menu, Settings'
// "Sign out everywhere" and the child page's "Not your device?" banner. Waits (briefly) until
// Better Auth no longer reports a session, so the sign-in page's signed-in redirect does not
// bounce straight back.
export const signOutAndGoToSignIn = async () => {
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
	await goto(resolve('/auth/sign-in'), { replaceState: true, invalidateAll: true });
};
