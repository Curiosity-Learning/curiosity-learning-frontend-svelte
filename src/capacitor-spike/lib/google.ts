// CL-819 spike, acceptance check 4: native Google sign-in, then Better Auth's ID-token sign-in
// (no redirect). Client ids are baked in at build time from public env:
// - PUBLIC_GOOGLE_WEB_CLIENT_ID: the WEB OAuth client (same as the backend's GOOGLE_CLIENT_ID).
//   Android's Credential Manager mints the ID token for this audience. Never put the Android
//   client id here: that one only ties the APK signature to the project and is never passed in.
// - PUBLIC_GOOGLE_IOS_CLIENT_ID: the iOS OAuth client (the backend's GOOGLE_IOS_CLIENT_ID).

export type GoogleClientIds = { webClientId?: string; iosClientId?: string };

export const missingGoogleConfig = (platform: string, ids: GoogleClientIds): string | null => {
	if (!ids.webClientId) return 'PUBLIC_GOOGLE_WEB_CLIENT_ID is not set in the spike build';
	if (platform === 'ios' && !ids.iosClientId) {
		return 'PUBLIC_GOOGLE_IOS_CLIENT_ID is not set in the spike build';
	}
	if (platform === 'web') return 'Native Google sign-in only runs inside the iOS/Android app';
	return null;
};

export const randomNonce = () => {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
};

/** Runs the native Google sheet; returns the ID token and the nonce it was minted with. */
export const nativeGoogleIdToken = async (ids: GoogleClientIds) => {
	const { SocialLogin } = await import('@capgo/capacitor-social-login');
	await SocialLogin.initialize({
		google: {
			webClientId: ids.webClientId,
			iOSClientId: ids.iosClientId,
			iOSServerClientId: ids.webClientId,
			mode: 'online'
		}
	});
	const nonce = randomNonce();
	const { result } = await SocialLogin.login({
		provider: 'google',
		options: { scopes: ['email', 'profile'], nonce }
	});
	const idToken = 'idToken' in result ? result.idToken : null;
	if (!idToken) throw new Error('Google returned no ID token (offline mode?)');
	return { idToken, nonce };
};
