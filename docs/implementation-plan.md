# Implementation Plan

> Migration progress from Flutter to SvelteKit. For feature parity checklist see [parity-matrix.md](parity-matrix.md).

## Source of Truth

- Legacy Flutter app: `/Users/ronberlinski/Documents/Curosity-Learning-Frontend`
- Imported reference snapshots: `ref/`

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

## Delivered Routes

- `/auth/sign-in`, `/auth/sign-up`, `/auth/reset-password`
- `/onboarding/get-started`, `/onboarding/join-club`, `/onboarding/join-club/[code]`, `/onboarding/start-club`
- `/club/[clubId]`, `/club/[clubId]/sessions`, `/club/[clubId]/projects`, `/club/[clubId]/members`
- `/feed`, `/chat`, `/profile`, `/settings`, `/notifications`
- `/project/[projectId]` — project detail page (view, edit, updates feed)
- `/session/[sessionId]/activities` — session detail (activities tab, drag-and-drop reordering)
- `/session/[sessionId]/attendees` — session detail (attendees tab)
- `/activity-booklet` — browsable activity template library (filterable by building block)
- `/activity-booklet/[activityId]` — activity detail with "Add to session" action
- `/privacy`, `/terms`

## Visual QA

Playwright screenshots saved in `docs/screenshots/`.

## Open Follow-ups

- Authenticated visual captures for protected app routes require a verified test account/session bootstrap in CI-like runs.
- Feature-level media surfaces should attach domain records to `mediaAssets` via `mediaAssetId`, not raw file URLs, S3 object keys, or legacy storage IDs.
- Compression and moderation work should now layer on top of the shared S3-backed upload foundation instead of changing storage plumbing again.
- Secure media delivery now builds on CloudFront + OAC + signed URLs minted by SvelteKit server code. Feature/domain reads should keep returning `mediaAssetId`-level references, and the app should resolve short-lived delivery URLs through server enrichment or `/api/media/refresh` rather than reintroducing a shared `/media/[assetId]` route.
