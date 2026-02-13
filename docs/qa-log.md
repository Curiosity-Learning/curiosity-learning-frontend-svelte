# QA Log

> Chronological record of changes, fixes, and test runs. Newest entries at the bottom.

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

## 2026-02-12

### Refactor: Project Creation Modal → Page

- Removed the `<Dialog>` for project creation from `club-projects-view.svelte`.
- Created dedicated route page at `/(app)/[clubId]/projects/new/+page.svelte` with Zod schema validation.
- "+" button now navigates via `href` instead of opening a modal.

### Architecture: Layout Groups for Tabbed Routes

- Restructured `projects/`, `session/[sessionId]/`, and `feed/` directories to use `(tabbed)/` layout groups.
- Tabbed routes (Current/Completed, Activities/Attendees, My Clubs/Global) live inside `(tabbed)/` and inherit the tab bar layout.
- Non-tabbed routes (e.g., `/projects/new`) sit outside and do not inherit tabs.

### Architecture: Form Pattern Established

- Chose **Field.\* + Superforms + Zod v4** as the standard form architecture (no Formsnap).
- Added `required` prop to `Field.Label` component for red asterisk indicators.
- Reference implementation: `/[clubId]/projects/new/+page.svelte`.

### Component: Field.Label Enhancement

- Added `required?: boolean` prop to `src/lib/components/ui/field/field-label.svelte`.
- When `required` is true, renders `<span class="text-destructive">*</span>` after the label text.

### Documentation

- Created ADR-001 (layout groups), ADR-002 (form architecture), ADR-003 (modal-to-page refactor) in `docs/adr/`.
- Updated `docs/architecture.md` with layout group structure, form patterns, and UI conventions.
- Added documentation maintenance policy to `AGENTS.md`.

### Run: Type Check

- `npm run check` ✅

### Refactor: Dialog-to-Detail-Page Pattern

- Reverted project creation from dedicated `/[clubId]/projects/new` page back to a creation dialog in `club-projects-view.svelte` with "Open" button.
- Created project detail page at `/project/[projectId]/+page.svelte` with description, status, members (AvatarStack), updates feed, and edit dialog via ActionMenu.
- Added `href` prop to `club-project-card.svelte` for linking to project detail page.
- Simplified session list dialog to creation-only (removed edit mode). "Open" creates session and navigates to `/session/[id]/activities`.
- Removed "Edit session" action from `ClubSessionCard` on list page; editing happens on the session detail page only.
- Updated ADR-003 to document the refined dialog-to-detail-page pattern.
- Deleted `src/routes/(app)/[clubId]/projects/new/` route files (page + schema).

### Schema: Project Due Date Required

- Changed `projects.dueDate` from `v.optional(v.number())` to `v.number()` in Convex schema.
- Updated `projects.create` mutation arg to require `dueDate`.
- Creation and edit dialogs now require due date (label updated, button disabled without it).
- Removed "No due date" fallback from project cards and detail page status labels.

### Run: Type Check

- `npm run check` ✅
