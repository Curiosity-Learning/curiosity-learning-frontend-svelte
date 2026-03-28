# Implementation Plan

> Migration progress from Flutter to SvelteKit. For feature parity checklist see [parity-matrix.md](parity-matrix.md).

## Source of Truth

- Flutter app: `/Users/ronberlinski/Documents/Curosity-Learning-Frontend`
- Legacy reference: `/Users/ronberlinski/Documents/curiosity-learning-flutter-to-svelte/ref`

## Phases

- [x] Phase 0: Audit + migration design
- [x] Phase 1: Foundation (shadcn, app shell, routing groups)
- [x] Phase 2: Auth + profile bootstrap parity
- [x] Phase 3: Clubs + memberships + invite-code flows
- [x] Phase 4: Sessions + activities + attendance
- [x] Phase 5: Projects + updates
- [x] Phase 6: Settings + preferences + notifications
- [x] Phase 7: Terms/privacy and initial chat slice
- [x] Phase 8: Hardening, tests, screenshots, lint/check gates
- [x] Phase 9: Shared media upload foundation
- [x] Phase 10: Media safety/compression hardening

## Delivered Routes

- `/auth/sign-in`, `/auth/sign-up`, `/auth/reset-password`
- `/onboarding/get-started`, `/onboarding/join-club`, `/onboarding/join-club/[code]`, `/onboarding/start-club`
- `/app/home`, `/app/sessions`, `/app/projects`, `/app/people`, `/app/settings`, `/app/notifications`, `/app/chat`
- `/project/[projectId]` — project detail page (view, edit, updates feed)
- `/session/[sessionId]/activities` — session detail (activities tab, drag-and-drop reordering)
- `/session/[sessionId]/attendees` — session detail (attendees tab)
- `/activity-booklet` — browsable activity template library (filterable by building block)
- `/activity-booklet/[activityId]` — activity detail with "Add to session" action
- `/privacy`, `/terms`

## Visual QA

Playwright screenshots saved in `docs/screenshots/`.

## Open Follow-ups

- Authenticated visual captures for full `/app/*` pages require a verified test account/session bootstrap in CI-like runs.
- Future feature-level media surfaces should attach domain records to `mediaAssets` using the shared constraint-based safety/compression pipeline instead of storing raw file URLs or ad-hoc storage IDs.
- Project updates now enforce approved `mediaAssets`; future pledge uploads, session photos, project cover images, and application-video uploads still need their own UI/domain wiring.
