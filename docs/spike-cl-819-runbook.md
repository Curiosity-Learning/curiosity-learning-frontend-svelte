# CL-819 spike runbook: Capacitor sign-in on a real phone

Throwaway branch `ron/cl-819-spike-capacitor-sign-in`. **Never merge it.** Nothing here touches
prod or shared dev. Everything runs against a **spike backend**: this worktree's own Convex
deployment (`good-nightingale-303`), or a preview backend of this branch.

## What is already proven without a phone

| Check                                                                                                                             | Where                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Header-cookie sign-in, Convex JWT, authenticated WebSocket query, "relaunch" from stored cookie, sign-out revokes the session row | `scripts/capacitor-spike/live-smoke.mjs` against the live worktree backend, both origins |
| CORS: `capacitor://localhost` and `https://localhost` only; all others get no `Access-Control-Allow-Origin`                       | `src/convex/nativeAppAuth.spec.ts`, live `curl`, headless Chromium                       |
| Sync Keychain cache: hydrate, sync read, ordered write-through, restart                                                           | `src/capacitor-spike/lib/secure-storage-cache.spec.ts`                                   |
| Emailed link → app verifies token (no redirect); browser verify → `?ott=` → one-time swap                                         | `src/convex/nativeAppAuth.spec.ts`                                                       |
| Web cookie sign-in unchanged with the plugin on                                                                                   | `src/convex/nativeAppAuth.spec.ts` plus the existing suite                               |

Still needs real phones: Keychain/Keystore itself, the WebView's real origin and CORS, the native
Google sheet, the universal link opening the app from Mail, and CloudFront media in the WebView.

## Findings so far (for the go/no-go)

1. **CORS is the gate, not `trustedOrigins`.** Better Auth checks Origin only when the raw request
   has a `Cookie` header. The crossDomain plugin turns `Better-Auth-Cookie` into a cookie later,
   so header sessions are never origin-checked, from any origin. That is safe: a browser never
   sends that header by itself, so there is no CSRF. And another origin cannot read
   `Set-Better-Auth-Cookie` without CORS. The native flow still passed with both native origins
   removed from `trustedOrigins`. They stay in for callback URLs and any future real-cookie
   request. The spec pins this behavior, so a Better Auth upgrade that changes it fails loudly.
2. **The library's `cors: true` is too wide.** It allows every `trustedOrigins` entry (web dev
   ports, ngrok, admin). `http.ts` registers the auth routes through a CORS router that allows
   only the two native origins, without credentials.
3. **crossDomain is not scoped to native requests.** It rewrites every relative `callbackURL` to
   an absolute one, and it turns off the OAuth state-cookie check for web too. That is why it
   sits behind `NATIVE_APP_AUTH=true`. It also broke the emailed `/auth/link` interstitial for
   self-service links, which fell back to the raw verify URL; fixed in
   `magicLinks.pluginVerifyUrlToInterstitial`. Production needs a decision on the OAuth state
   check (web OAuth through crossDomain loses login-CSRF protection).
4. **Universal links must open `/auth/link` directly.** A verify that runs in Safari and then
   redirects to the same domain does not reliably open the app. The app therefore claims
   `/auth/link` and `/app/*`, reads the token from the fragment and verifies it itself. The
   one-time-token path still works for redirects and is handled too. Side effect to decide:
   with the app installed, every `/auth/link` tap opens the app.
5. **Better Auth's Origin check is off under `NODE_ENV=test`.** Existing specs that assert
   origin behavior prove nothing; `nativeAppAuth.spec.ts` forces production mode.

## 0. One-time machine setup

- Xcode 16+ with an Apple developer team. Android Studio with SDK 35+.
- Node 24: `export PATH=/opt/homebrew/opt/node@24/bin:$PATH`
- `git fetch && git switch ron/cl-819-spike-capacitor-sign-in && npm install`
- `npm run worktree:setup` if this is a new checkout (gives it its own backend).

## 1. Spike backend env (Convex)

Run in the checkout whose `.env.local` names the spike backend. **Never** add `--prod`.

```sh
npx convex env set NATIVE_APP_AUTH true            # already set on good-nightingale-303
npx convex env set BETTER_AUTH_SECRET "$(openssl rand -base64 32)"   # unset on the worktree backend
# Check 4 (Google):
npx convex env set GOOGLE_CLIENT_ID     <web client id>.apps.googleusercontent.com
npx convex env set GOOGLE_CLIENT_SECRET <web client secret>
npx convex env set GOOGLE_IOS_CLIENT_ID <ios client id>.apps.googleusercontent.com
# Check 5 (links): the https origin the phone opens links on, plus email sending
npx convex env set BETTER_AUTH_URL https://<link domain>
npx convex env set RESEND_API_KEY <key>   # and RESEND_FROM if needed
# Check 6 (media): MEDIA_CDN_BASE_URL, MEDIA_CLOUDFRONT_PUBLIC_KEY_ID, MEDIA_CLOUDFRONT_PRIVATE_KEY (+ storage vars for uploads)
npx convex dev --once
```

Test user (or sign up normally on the worktree URL):

```sh
H=$(node -e "import('better-auth/crypto').then(async m=>console.log(await m.hashPassword('Spike-Password-819')))")
N=$(date +%s000)
npx convex run --component betterAuth adapter:create "{\"input\":{\"model\":\"user\",\"data\":{\"email\":\"you+spike@example.com\",\"emailVerified\":true,\"name\":\"Spike\",\"createdAt\":$N,\"updatedAt\":$N}}}"
# then the same with model "account": {accountId: <user _id>, providerId: "credential", userId: <user _id>, password: "$H", ...}
```

`cl819-spike@example.com` / `Spike-Password-819` already exists on `good-nightingale-303`.

Smoke test from the Mac before touching a phone:

```sh
SITE=https://good-nightingale-303.convex.site EMAIL=cl819-spike@example.com PASSWORD=Spike-Password-819 \
  node scripts/capacitor-spike/live-smoke.mjs capacitor://localhost
```

## 2. The link domain (check 5 only)

Universal links need a public https domain with no redirect and no Vercel login in front of it.
Preview URLs behind Vercel auth will not validate. Pick one:

- **Quickest:** the ngrok domain already in `trustedOrigins`. Point it at `npm run dev` in this
  worktree, set `BETTER_AUTH_URL` on the backend to `https://arrased-semiurban-jean.ngrok-free.dev`,
  and use `APP_LINK_DEV_MODE=1` below. With Developer Mode on and Settings → Developer →
  Associated Domains Development switched on, iOS fetches the file directly instead of through
  Apple's CDN.
- **Closer to real:** a spare subdomain aliased to this branch's Vercel deployment with
  protection off.

The web app serves both files from env, and 404s while they are unset:

```sh
NATIVE_APP_IOS_APP_IDS=<APPLE_TEAM_ID>.org.curiositylearning.spike
NATIVE_APP_ANDROID_SHA256=<SHA-256 of the signing cert>   # debug: keytool -list -v -keystore ~/.android/debug.keystore -storepass android
```

→ `https://<link domain>/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json`.

## 3. Google OAuth clients (check 4 only)

In the Google Cloud project that owns the web client:

- **iOS client**: bundle id `org.curiositylearning.spike`. Its id goes into `GOOGLE_IOS_CLIENT_ID`
  (backend) and `PUBLIC_GOOGLE_IOS_CLIENT_ID` (app build).
- **Android client**: package `org.curiositylearning.spike` plus the **SHA-1** of the signing cert.
  Its id is **never put in code or env**. It only registers the APK. Passing it as `webClientId`
  is the known mistake: Android mints the ID token for the **web** client id.
- `PUBLIC_GOOGLE_WEB_CLIENT_ID` = the existing web client id (same as backend `GOOGLE_CLIENT_ID`).

The backend accepts `[web, ios]` as audiences (`nativeAppAuth.googleClientIds`).
`disableImplicitSignUp` stays on, so the Google account must already exist as a user.

## 4. Build the app

```sh
export PUBLIC_GOOGLE_WEB_CLIENT_ID=<web client id>
export PUBLIC_GOOGLE_IOS_CLIENT_ID=<ios client id>
export PUBLIC_NATIVE_APP_LINK_ORIGIN=https://<link domain>     # same origin as BETTER_AUTH_URL
APP_LINK_DOMAIN=<link domain> GOOGLE_IOS_CLIENT_ID=$PUBLIC_GOOGLE_IOS_CLIENT_ID \
  APP_LINK_DEV_MODE=1 node scripts/capacitor-spike/configure-native.mjs
npm run build:capacitor-spike    # static SPA → build-capacitor/, then cap sync
```

`PUBLIC_CONVEX_URL` / `PUBLIC_CONVEX_SITE_URL` come from `.env.local`, so the spike backend is
baked into `build-capacitor/_app/env.js`. Check that file before installing.

**iOS:** `npx cap open ios` → target App → Signing & Capabilities: pick the team (Associated
Domains is already in `App/App.entitlements`) → run on the iPhone.
**Android:** `npx cap open android` → run on the phone (debug keystore matches the SHA values above).

## 5. The seven checks (one screen, one panel each)

1. **Password + WebSocket**: sign in. "Better Auth session" shows the email, "Convex WebSocket"
   shows `authenticated`, and `auth.getCurrentUser (live)` shows the user.
2. **Kill + relaunch**: force-quit and reopen. The top line says "a session cookie was restored
   at launch", and panel 1 is signed in without typing anything.
3. **Sign-out**: press it. Expect `PASS: the old session cookie is rejected by the server`. Server
   side, the user has no session row:
   `npx convex run --component betterAuth adapter:findMany '{"model":"session","where":[{"field":"userId","value":"<user _id>"}],"paginationOpts":{"cursor":null,"numItems":10}}'`
4. **Google**: the native sheet opens. Expect `PASS: signed in with a native Google ID token`.
5. **Link**: type the email in panel 1, press "Email me a sign-in link", and open it in Mail on
   the phone. The app opens, "Last link" shows the `/auth/link#…` URL, and you see
   `PASS: signed in from the emailed link`.
6. **Media**: sign in as a user with a ready image and video upload, then press "Load". The image
   shows and the video plays inline.
7. **Origins**: iOS shows `capacitor://localhost`, Android `https://localhost`, both "(one of the
   two native origins)". The CORS probe says `PASS`.

Record screenshots of each panel per platform for the Fibery findings comment.

## Code map

- Backend: `src/convex/nativeAppAuth.ts` (flag, origins, Google audiences), `auth.ts`
  (crossDomain plus origins, flag-gated), `http.ts` (native-only CORS),
  `capacitorSpikeNode.ts` (signed media for the app), `magicLinks.ts` (interstitial fix).
- App: `src/capacitor-spike/` (routes, secure-storage cache, auth client, deep links, Google),
  `capacitor.config.ts`, `ios/`, `android/`, `svelte.config.js` (`CAPACITOR_SPIKE_BUILD=1`).
- Web: `src/routes/.well-known/*` and `src/lib/server/native-app-links.ts`.
