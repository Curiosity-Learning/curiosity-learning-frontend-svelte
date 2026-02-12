# Curiosity Learning (SvelteKit + shadcn-svelte + Convex)

Production migration target for `/Users/ronberlinski/Documents/Curosity-Learning-Frontend`.

## Stack

- SvelteKit (Svelte 5, TypeScript)
- Tailwind CSS v4 + shadcn-svelte
- Convex backend (`src/convex`)
- Better Auth (`@convex-dev/better-auth`, `@mmailaender/convex-better-auth-svelte`)
- Vitest + Playwright

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

2. Ensure env values are set:

- `PUBLIC_CONVEX_URL`
- `PUBLIC_CONVEX_SITE_URL`
- `BETTER_AUTH_SECRET` (non-default, high entropy)
- `CONVEX_DEPLOYMENT` (for local Convex dev/codegen)

3. Start backend + frontend:

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
