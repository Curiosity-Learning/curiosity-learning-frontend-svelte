import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

const normalizeRedirectTarget = (nextPath: string | null) => {
	if (!nextPath || !nextPath.startsWith('/')) return '/';
	if (nextPath.startsWith('/auth/')) return '/';
	if (nextPath === '/onboarding/get-started') return '/';
	return nextPath;
};

export const load: LayoutServerLoad = async ({ locals, url }) => {
	if (url.pathname === '/auth/sign-up') {
		return {};
	}
	// The sign-in link interstitial must open for a signed-in visitor too: its `next` is in the
	// URL fragment (invisible here), and pressing its button deliberately replaces the current
	// session — the consent page warns when another session is active on the device.
	if (url.pathname === '/auth/link') {
		return {};
	}
	// Settings' "Set a password" sends a reset email to a signed-in parent; Better Auth's
	// `/reset-password/{token}` redirects back here with `?token=…`. Setting a password for the
	// account the token names is legitimate while signed in (the reset is keyed by the token, not
	// the session), so the form must open instead of bouncing to `next` (review S1). Without a
	// token (the "request a reset" form) a signed-in visitor is still redirected.
	if (url.pathname === '/auth/reset-password' && url.searchParams.has('token')) {
		return {};
	}

	if (locals.token) {
		throw redirect(307, normalizeRedirectTarget(url.searchParams.get('next')));
	}

	return {};
};
