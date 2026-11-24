#!/usr/bin/env node
// CL-819 spike: writes the per-environment native settings that cannot live in
// capacitor.config.ts. Idempotent; rerun after changing any input, then `npx cap sync`.
//
//   APP_LINK_DOMAIN=spike.example.org \
//   GOOGLE_IOS_CLIENT_ID=1234-abc.apps.googleusercontent.com \
//   APP_LINK_DEV_MODE=1 \
//   node scripts/capacitor-spike/configure-native.mjs
//
// - iOS: Associated Domains (applinks:<domain>) in App.entitlements, and the reversed iOS
//   client id as a URL scheme in Info.plist (Google Sign-In's callback).
// - Android: an autoVerify https intent filter for <domain>/auth/link and <domain>/app/.
import { readFileSync, writeFileSync } from 'node:fs';

const domain = process.env.APP_LINK_DOMAIN?.trim();
const iosClientId = process.env.GOOGLE_IOS_CLIENT_ID?.trim();
// APP_LINK_DEV_MODE=1: `applinks:<domain>?mode=developer`, so iOS fetches the association file
// straight from the domain instead of Apple's CDN (needs Developer Mode and Settings → Developer →
// Associated Domains Development on the phone). Lets a tunnel such as ngrok work right away.
const devMode = process.env.APP_LINK_DEV_MODE === '1';
if (!domain || !/^[a-z0-9.-]+$/i.test(domain)) {
	console.error('Set APP_LINK_DOMAIN to the bare https host of the web app (no scheme, no path).');
	process.exit(1);
}

const ENTITLEMENTS = 'ios/App/App/App.entitlements';
writeFileSync(
	ENTITLEMENTS,
	`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>com.apple.developer.associated-domains</key>
	<array>
		<string>applinks:${domain}${devMode ? '?mode=developer' : ''}</string>
	</array>
</dict>
</plist>
`
);
console.log(`✔ ${ENTITLEMENTS}: applinks:${domain}${devMode ? '?mode=developer' : ''}`);

const PLIST = 'ios/App/App/Info.plist';
const START = '<!-- cl-819:google-url-scheme -->';
const END = '<!-- /cl-819:google-url-scheme -->';
let plist = readFileSync(PLIST, 'utf8').replace(new RegExp(`\\s*${START}[\\s\\S]*?${END}`), '');
if (iosClientId) {
	const reversed = iosClientId.split('.').reverse().join('.');
	plist = plist.replace(
		/<dict>/,
		`<dict>
	${START}
	<key>CFBundleURLTypes</key>
	<array>
		<dict>
			<key>CFBundleURLSchemes</key>
			<array>
				<string>${reversed}</string>
			</array>
		</dict>
	</array>
	${END}`
	);
	console.log(`✔ ${PLIST}: URL scheme ${reversed}`);
} else {
	console.log(`- ${PLIST}: GOOGLE_IOS_CLIENT_ID unset, no Google URL scheme`);
}
writeFileSync(PLIST, plist);

const MANIFEST = 'android/app/src/main/AndroidManifest.xml';
const A_START = '<!-- cl-819:app-links -->';
const A_END = '<!-- /cl-819:app-links -->';
let manifest = readFileSync(MANIFEST, 'utf8').replace(
	new RegExp(`\\s*${A_START}[\\s\\S]*?${A_END}`),
	''
);
manifest = manifest.replace(
	/(<category android:name="android.intent.category.LAUNCHER" \/>\s*<\/intent-filter>)/,
	`$1

            ${A_START}
            <intent-filter android:autoVerify="true">
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="https" android:host="${domain}" android:pathPrefix="/auth/link" />
                <data android:scheme="https" android:host="${domain}" android:pathPrefix="/app/" />
            </intent-filter>
            ${A_END}`
);
writeFileSync(MANIFEST, manifest);
console.log(`✔ ${MANIFEST}: App Links for https://${domain}/auth/link and /app/`);
