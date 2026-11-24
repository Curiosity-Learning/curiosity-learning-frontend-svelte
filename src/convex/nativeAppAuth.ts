// CL-819 spike (throwaway branch, never merged): settings that let the bundled Capacitor app
// sign in against this deployment. Everything here is off unless NATIVE_APP_AUTH=true is set on
// the Convex deployment, so the web app's cookie auth is untouched wherever the flag is unset.
//
// Why a flag and not always-on: the crossDomain plugin is not scoped to native requests. It
// rewrites every relative callbackURL to an absolute one and switches OAuth state to
// database-only (no state cookie check) for every client, web included. Fine for a spike backend;
// a production rollout has to decide that on purpose (see docs/spike-cl-819-runbook.md).

// The WebView origins Capacitor serves the bundled app from: iOS uses the `capacitor` scheme,
// Android serves https://localhost (androidScheme defaults to https since Capacitor 6).
export const NATIVE_APP_ORIGINS = ['capacitor://localhost', 'https://localhost'] as const;

type Env = Record<string, string | undefined>;

const read = (env: Env, key: string) => {
	const value = env[key]?.trim();
	return value ? value : undefined;
};

export const isNativeAppAuthEnabled = (env: Env = process.env) =>
	read(env, 'NATIVE_APP_AUTH') === 'true';

/** Extra Better Auth trustedOrigins for the native app; empty when the flag is off. */
export const nativeAppTrustedOrigins = (env: Env = process.env): string[] =>
	isNativeAppAuthEnabled(env) ? [...NATIVE_APP_ORIGINS] : [];

/**
 * Origins that get CORS headers on /api/auth/*: only the two native WebView origins. The web app
 * reaches Better Auth through its own same-origin /api/auth proxy (server to server), so it never
 * needs CORS; everything else gets no Access-Control-Allow-Origin and the browser blocks it.
 */
export const nativeAppCorsOrigins = (env: Env = process.env): string[] =>
	isNativeAppAuthEnabled(env) ? [...NATIVE_APP_ORIGINS] : [];

/**
 * Audiences accepted for Google ID tokens. A native Google sign-in mints the ID token for:
 * - Android (Credential Manager): the WEB client id (the "server client id" the app passes as
 *   webClientId) — never the Android client id, which only identifies the APK signature;
 * - iOS (GoogleSignIn): the iOS client id.
 * So the provider must accept [webClientId, iosClientId]. Better Auth 1.7 takes an array and
 * uses the first entry for the redirect flow, so the web id stays first.
 */
export const googleClientIds = (env: Env = process.env): string | string[] | undefined => {
	const web = read(env, 'GOOGLE_CLIENT_ID') ?? read(env, 'AUTH_GOOGLE_ID');
	if (!web) return undefined;
	const ios = isNativeAppAuthEnabled(env) ? read(env, 'GOOGLE_IOS_CLIENT_ID') : undefined;
	return ios && ios !== web ? [web, ios] : web;
};
