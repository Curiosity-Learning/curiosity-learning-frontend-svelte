# QA Log

## 2026-02-08

### UI: Bottom Navigation + Profile

- Bottom navigation now uses 4 tabs: `Club`, `Feed`, `Chat`, `Profile`.
- Each tab renders a consistent icon + label UI (no special-case avatar rendering).
- Added `/app/profile` for account shortcuts (Settings, Notifications, Sign out) and active-club context.
- Extended Playwright screenshot coverage for `/app/feed`, `/app/chat`, and `/app/profile` auth-gate states (see `docs/screenshots/`).

### Auth: Origin Check

- Fixed Better Auth `Invalid origin` sign-in failures when accessing the app via LAN IP (e.g. `http://10.x.x.x:5173`) by expanding `trustedOrigins` patterns in `/src/convex/auth.ts`.

### Run: Type/Lint/Unit/E2E

- `npm run lint` ✅
- `npm run check` ✅
- `npm run test:unit -- --run` ✅
- `npm run test:e2e` ✅

### Unit Tests Added

- `src/lib/domain/date.spec.ts`
- `src/lib/domain/session.spec.ts`

### E2E Coverage Added

- `e2e/smoke-and-screenshots.test.ts`
  - Root/public route smoke checks
  - Auth and onboarding route rendering checks
  - Screenshot capture pipeline to `docs/screenshots`

### Notes

- During Playwright runs, transient server logs can show aborted `/api/auth/get-session` requests while pages navigate rapidly.
- These requests did not fail the suite and all assertions passed.
- Playwright's `webServer` boot now injects a stable `BETTER_AUTH_SECRET` in `playwright.config.ts` so `vite preview` can start reliably (it does not automatically load `.env`).
