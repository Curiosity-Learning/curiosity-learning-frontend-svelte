import type { CapacitorConfig } from '@capacitor/cli';

// CL-819 spike (throwaway branch, never merged). The app ships the static SPA bundled inside the
// binary (webDir); there is deliberately no `server.url`, so the WebView never loads remote code
// and its origin stays capacitor://localhost (iOS) / https://localhost (Android) — the two origins
// the backend trusts when NATIVE_APP_AUTH=true.
const config: CapacitorConfig = {
	appId: 'org.curiositylearning.spike',
	appName: 'Curiosity Spike',
	webDir: 'build-capacitor',
	server: {
		// Both are the defaults; pinned because the backend's CORS/trustedOrigins entries depend on
		// them.
		androidScheme: 'https',
		iosScheme: 'capacitor'
	},
	plugins: {
		SocialLogin: {
			// Only Google is linked into the native projects.
			providers: {
				google: true,
				facebook: false,
				apple: false,
				twitter: false
			}
		}
	}
};

export default config;
