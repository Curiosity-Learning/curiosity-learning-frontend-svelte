// CL-819 spike: the two files that let the web app's domain open the native app (universal links
// on iOS, App Links on Android). Built from env so nothing is served until the spike deployment
// sets them; the paths match scripts/capacitor-spike/configure-native.mjs.
export const NATIVE_APP_LINK_PATHS = ['/auth/link', '/app/*'];
export const ANDROID_PACKAGE = 'org.curiositylearning.spike';

const list = (value: string | undefined) =>
	(value ?? '')
		.split(',')
		.map((entry) => entry.trim())
		.filter(Boolean);

/** NATIVE_APP_IOS_APP_IDS: "<TEAMID>.org.curiositylearning.spike" (comma-separated). */
export const appleAppSiteAssociation = (iosAppIds: string | undefined) => {
	const appIDs = list(iosAppIds);
	if (appIDs.length === 0) return null;
	return {
		applinks: {
			details: [
				{
					appIDs,
					components: NATIVE_APP_LINK_PATHS.map((path) => ({ '/': path }))
				}
			]
		}
	};
};

/** NATIVE_APP_ANDROID_SHA256: signing-certificate SHA-256 fingerprints (comma-separated). */
export const androidAssetLinks = (fingerprints: string | undefined) => {
	const sha256_cert_fingerprints = list(fingerprints).map((value) => value.toUpperCase());
	if (sha256_cert_fingerprints.length === 0) return null;
	return [
		{
			relation: ['delegate_permission/common.handle_all_urls'],
			target: { namespace: 'android_app', package_name: ANDROID_PACKAGE, sha256_cert_fingerprints }
		}
	];
};
