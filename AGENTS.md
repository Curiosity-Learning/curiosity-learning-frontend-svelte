# Agent Instructions (Curiosity Learning SvelteKit)

These instructions exist to keep iteration fast while still shipping production-quality code.

## Default Dev Workflow (Speed First)

- Prefer a **tight loop**: make changes, refresh the running app, and only run checks when there is a reason.
- Do **not** run full E2E/screenshot suites after every small UI tweak.
- Keep `npm run dev` and `npm run dev:backend` running in separate terminals during active development.

## Testing Policy (When To Run What)

- **Tight loop (most edits)**:
  - No commands; validate by refreshing the app in the browser.
- **Medium gate (feature is ready to try / before asking user to test)**:
  - `npm run check`
  - Optional: `npm run lint:fast`
- **Hard gate (milestone / before calling a feature done)**:
  - `npm run lint`
  - `npm test` (unit + Playwright)

## Fast Commands (Preferred)

- Typecheck: `npm run check`
- Fast lint (cached): `npm run lint:fast`
- Unit-only: `npm run test:quick`
- E2E against an already-running server (no build/preview boot): `npm run test:e2e:local`
  - Set `E2E_BASE_URL` to point at the server under test.

## Where Speed Optimizations Live

- Scripts: `package.json`
- Local e2e config (no webServer): `playwright.local.config.ts`
- E2E base URL override: `e2e/smoke-and-screenshots.test.ts` (reads `E2E_BASE_URL`)

## Skill Usage Expectations

When working in this repo:

- UI work: use `shadcn-svelte-frontend-design` guidelines (shadcn components, gap-based spacing, avoid margin utilities).
- Backend work: use `convex` guidelines (indexes via `withIndex`, no `.filter()`, correct validators, etc).
- Auth work: use `better-auth-best-practices` guidelines (trusted origins, secrets, email flows).
- Browser validation/screenshots: use `playwright-skill` when explicitly requested or when verifying complex flows.

## Notes / Guardrails

- Keep secrets out of the repo. Use Convex env vars for backend secrets.
- LAN dev (if needed): Better Auth origin checks should remain strict in production. Any widened dev-only origin patterns should be guarded by an explicit env flag.

