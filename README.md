# Curiosity Learning Frontend

SvelteKit frontend and Convex backend for Curiosity Learning.

## Stack

- SvelteKit (Svelte 5, TypeScript)
- Tailwind CSS v4 + shadcn-svelte
- Convex backend (`src/convex`)
- Better Auth (`@convex-dev/better-auth`, `@mmailaender/convex-better-auth-svelte`)
- Vitest + Playwright

## Auth Runtime Notes

- No Better Auth vendor account is required for this project.
- Better Auth runs as a library in this codebase (SvelteKit + Convex).
- User/session data is stored via the Convex Better Auth adapter.
- Resend is the external provider used for verification/reset email delivery.

## App Areas

- `/auth/*`: sign in, sign up, reset password
- `/onboarding/*`: get started, join club (code preview), start club
- Authenticated shell routes: `/club/[clubId]`, `/feed`, `/chat`, `/profile`, `/settings`, `/notifications`
- `/privacy`, `/terms`: policy pages backed by active Convex policy content

## Local Setup

1. Install dependencies:

```sh
npm install
```

2. Set local app env values (copy `.env.example` to `.env.local`):

- `CONVEX_DEPLOYMENT` (for local Convex dev/codegen)
- `PUBLIC_CONVEX_URL`
- `PUBLIC_CONVEX_SITE_URL`
- `PUBLIC_MAPBOX_ACCESS_TOKEN` (for onboarding location search/map preview)
- `PUBLIC_SENTRY_DSN` (public Sentry project DSN; already present in `.env.example`)
- `PUBLIC_SENTRY_ENVIRONMENT` (typically `development` locally)
- `BETTER_AUTH_SECRET` (non-default, high entropy)
- `BETTER_AUTH_URL` (typically `http://localhost:5173`)
- `GOOGLE_CLIENT_ID` (for Google OAuth sign-up/sign-in)
- `GOOGLE_CLIENT_SECRET` (for Google OAuth sign-up/sign-in)

Google OAuth callback URL for local setup:

- `http://localhost:5173/api/auth/callback/google`

3. Set Convex deployment env values (server-side runtime):

- `BETTER_AUTH_SECRET` (match local value)
- `BETTER_AUTH_URL` (match local value)
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `RESEND_API_KEY`
- `RESEND_FROM` (optional override; default exists in code)
- `MEDIA_S3_REGION`, `MEDIA_S3_BUCKET`, `MEDIA_S3_ACCESS_KEY_ID`, `MEDIA_S3_SECRET_ACCESS_KEY` (for upload storage)

```sh
npx convex env set BETTER_AUTH_SECRET <same-secret-as-env-local>
npx convex env set BETTER_AUTH_URL http://localhost:5173
npx convex env set GOOGLE_CLIENT_ID <google-client-id>
npx convex env set GOOGLE_CLIENT_SECRET <google-client-secret>
npx convex env set RESEND_API_KEY <key>
npx convex env set RESEND_FROM "Curiosity Learning <your-verified-from@domain.com>"
```

4. Start backend + frontend:

```sh
npm run dev:backend
npm run dev
```

## Production Deployment

Deploy the web app to Vercel using SvelteKit's Node runtime.

- Adapter: `@sveltejs/adapter-vercel`
- Runtime: Node.js 22
- Build command: `npm run build`

Vercel production env values:

- `BETTER_AUTH_URL=https://<your-production-domain>`
- `BETTER_AUTH_SECRET=<high-entropy secret>`
- `PUBLIC_CONVEX_URL=https://<your-production-deployment>.convex.cloud`
- `PUBLIC_CONVEX_SITE_URL=https://<your-production-deployment>.convex.site`
- `PUBLIC_MAPBOX_ACCESS_TOKEN=<mapbox-token>`
- `PUBLIC_SENTRY_DSN=https://d01f876073a72f8b3d36d41a8372e2c8@o4511563803852800.ingest.de.sentry.io/4511563814207568`
- `PUBLIC_SENTRY_ENVIRONMENT=production`
- `SENTRY_ENVIRONMENT=production`
- `SENTRY_AUTH_TOKEN=<private Sentry source-map upload token>`
- `MONITORING_REPORT_SECRET=<random shared secret>`
- `RESEND_WEBHOOK_SECRET=<Resend webhook signing secret>`
- `ALLOW_LAN_TRUSTED_ORIGINS=false`

Convex production deployment env values:

- `BETTER_AUTH_URL=https://<your-production-domain>`
- `BETTER_AUTH_SECRET=<same secret as Render>`
- `PUBLIC_CONVEX_SITE_URL=https://<your-production-deployment>.convex.site`
- `RESEND_API_KEY=<provider key>`
- `RESEND_FROM=<verified sender>`
- `MONITORING_REPORT_SECRET=<same random shared secret as Vercel>`
- `MEDIA_S3_*` values for the media bucket
- `ALLOW_LAN_TRUSTED_ORIGINS=false`

Complete the Sentry alert, uptime, Resend webhook, and verification steps in
[`docs/monitoring.md`](docs/monitoring.md) before public launch.

## Quality Gates

Baseline PR gate via GitHub Actions (`pull_request` plus pushes to `main` and `development`):

```sh
npm ci
npm run check
npm run lint:ci
npm run build
```

Hard gate before bigger milestones:

```sh
npm run lint
npm run check
npm run test:unit -- --run
npm run test:e2e
```

Playwright screenshots are generated into `docs/screenshots/` and are ignored by Git.

## Documentation

Current reference docs:

- [`docs/architecture.md`](docs/architecture.md)
- [`docs/data-model.md`](docs/data-model.md)
- [`docs/security.md`](docs/security.md)

## Notes

- Convex codegen output lives in `src/convex/_generated`.
- The production app runs in Vercel Node functions, not as a static export.
