# Curiosity Learning Migration Plan (Flutter -> SvelteKit + shadcn + Convex)

## Objective

Port `/Users/ronberlinski/Documents/Curosity-Learning-Frontend` into this repository with production-quality SvelteKit frontend, shadcn-svelte components, and Convex-backed data/auth flows.

## Source Of Truth

- Flutter routes/screens in `/Users/ronberlinski/Documents/Curosity-Learning-Frontend`
- Legacy table/function reference in `/Users/ronberlinski/Documents/curiosity-learning-flutter-to-svelte/ref`

## Phase Status

- [x] Phase 0: Audit + migration design
- [x] Phase 1: Foundation (shadcn, app shell, routing groups)
- [x] Phase 2: Auth + profile bootstrap parity
- [x] Phase 3: Clubs + memberships + invite-code flows
- [x] Phase 4: Sessions + activities + attendance
- [x] Phase 5: Projects + updates
- [x] Phase 6: Settings + preferences + notifications
- [x] Phase 7: Terms/privacy and initial chat slice
- [x] Phase 8: Hardening, tests, screenshots, lint/check gates

## Delivered Route Surface

- `/auth/sign-in`, `/auth/sign-up`, `/auth/reset-password`
- `/onboarding/get-started`, `/onboarding/join-club`, `/onboarding/join-club/[code]`, `/onboarding/start-club`
- `/app/home`, `/app/sessions`, `/app/projects`, `/app/people`, `/app/settings`, `/app/notifications`, `/app/chat`
- `/privacy`, `/terms`

## Validation Gates

- `npm run lint` ✅
- `npm run check` ✅
- `npm run test:unit -- --run` ✅
- `npm run test:e2e` ✅

## Visual QA Artifacts

Playwright screenshots saved in `docs/screenshots/`:

- `auth-sign-in.png`
- `auth-sign-up.png`
- `onboarding-get-started.png`
- `onboarding-join-club.png`
- `onboarding-start-club.png`
- `privacy.png`
- `terms.png`
- `app-home-auth-gate.png`
- `app-sessions-auth-gate.png`
- `app-projects-auth-gate.png`
- `app-settings-auth-gate.png`

## Open Follow-ups

- Authenticated visual captures for full `/app/*` pages require a verified test account/session bootstrap in CI-like runs.
