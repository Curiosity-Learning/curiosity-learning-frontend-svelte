# Curiosity Learning (SvelteKit + shadcn-svelte + Convex)

Production migration target for `/Users/ronberlinski/Documents/Curosity-Learning-Frontend`.

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
- `/app/*`: authenticated shell with home, sessions, projects, people, settings, notifications, chat
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
- `BETTER_AUTH_SECRET` (non-default, high entropy)
- `BETTER_AUTH_URL` (typically `http://localhost:5173`)

3. Set Convex deployment env values (server-side runtime):

- `BETTER_AUTH_SECRET` (match local value)
- `BETTER_AUTH_URL` (match local value)
- `RESEND_API_KEY`
- `RESEND_FROM` (optional override; default exists in code)

```sh
npx convex env set BETTER_AUTH_SECRET <same-secret-as-env-local>
npx convex env set BETTER_AUTH_URL http://localhost:5173
npx convex env set RESEND_API_KEY <key>
npx convex env set RESEND_FROM "Curiosity Learning <your-verified-from@domain.com>"
```
4. Start backend + frontend:

```sh
npm run dev:backend
npm run dev
```

## Quality Gates

```sh
npm run lint
npm run check
npm run test:unit -- --run
npm run test:e2e
```

Playwright screenshots are saved in `docs/screenshots/`.

## Documentation

See [`docs/README.md`](docs/README.md) for the full docs index — architecture, data model, security, ADRs, and more.

## Notes

- Convex codegen output lives in `src/convex/_generated`.
- Demo scaffold routes/tests were removed and replaced by migration smoke + domain tests.
