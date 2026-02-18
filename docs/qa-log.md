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

## 2026-02-13

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

## 2026-02-14

### Feature: Responsive Header Search

- Added `PageHeaderSearch` as a first-class page-header override, parallel to `PageHeaderActions` and `PageHeaderTitle`.
- Extended app header rendering in `AppShell` with three search modes:
  - `inline`: always-open field in header actions area.
  - `collapsible`: search icon expands to input with autofocus and collapses when blurred + empty.
  - `overlay`: always-open field intentionally overlays title lane while preserving back-button lane.
- Added `auto` mode to resolve between inline/collapsible/overlay based on available header width.
- Tuned responsive behavior after manual QA:
  - only large (`inline`) mode is open by default;
  - medium (`collapsible`) and narrow (`overlay`) modes are icon-triggered;
  - collapsible expansion now opens to the left of the search icon;
  - collapsible focus ring clipping was fixed while preserving default `Input` styles by using padded animated wrapper spacing with compensating negative margin.
- Migrated project and session list pages off duplicated in-page search UI to the shared header search API.

### Documentation

- Added ADR-005 for responsive header search mode architecture.
- Updated architecture and docs index references.

### Run: Type Check

- `npm run check` ✅

### Bug Fix: DnD Shadow Action Menu Flash

- Fixed one-frame ghost `⋮` action-menu flash on activity drag start in session detail.
- `session-detail-view.svelte` now reads `SHADOW_ITEM_MARKER_PROPERTY_NAME` from `svelte-dnd-action` item data and passes `isDndShadowItem` to each card.
- `session-activity-card.svelte` renders dnd shadow rows with `invisible` immediately, preserving layout while hiding content before library `decorateShadowEl()` runs.

### Run: Type Check

- `npm run check` ✅

## 2026-02-18

### Feature: Inline Activity Card Editing Expansion

- Session activity cards now support inline title editing via a single-line input (blur-save), fixing caret/cursor instability seen with contenteditable title editing.
- Reduced vertical spacing between title and description for tighter card density.
- Replaced minutes badge with inline numeric input that persists on blur.
- Removed static "Prep needed/Little prep" badge.
- Added reusable `inline-multi-select.svelte` with searchable multi-select UX (chips + input + listbox) built from shadcn primitives, including keyboard navigation and focus-leave save behavior.
- Updated session detail view to persist inline field changes through shared `saveInlineActivity` mutation helper.

### Documentation

- Updated `docs/inline-activity-editing.md` for title/minutes/building-block inline editing behavior.
- Updated `docs/architecture.md` with inline activity editing pattern note.

### Run: Type Check

- `npm run check` ✅ (0 errors, existing upstream warnings in `src/lib/components/ui/toggle-group/toggle-group.svelte`)

### Bug Fix: Inline Multi-Select Interaction Hardening

- Kept building-block options menu open after selection so users can make multiple picks without reopening.
- Removed default first-option highlight on plain click focus; highlight now starts only from hover or arrow-key navigation.
- Stabilized click behavior around chip remove and option select by retaining input focus and preventing unintended blur/open side effects.
- Matched multi-select control height to the minutes input row and added explicit pointer cursors on clickable affordances.

### Run: Type Check

- `npm run check` ✅ (0 errors, same existing toggle-group warnings)

### Finalization: In-Chip Remove UX + Documentation Cleanup

- Finalized selected-tag removal in inline multi-select with a simple in-chip `x` control (`TagChip` removable mode).
- Removed experimental external-remove-button layout from active implementation to keep MVP behavior predictable and maintainable.
- Added inline code comments in multi-select for two non-obvious behaviors:
  - optimistic selected-chip sync during async saves,
  - delayed blur-close logic for intra-control focus movement.
- Added ADR-006 documenting the `Badge` (primitive) + `TagChip` (token/interactions) split and updated docs references.

### Run: Type Check

- `npm run check` ✅ (0 errors, same existing toggle-group warnings)

### Refactor: Multi-Select Component Cleanup

- Cleaned `inline-multi-select.svelte` internals to reduce branching and duplicate save logic.
- Introduced derived booleans (`canSave`, `canInteract`) for clearer template and interaction gates.
- Centralized persistence in `persistSelection()` and reused it for blur-save and chip removal save paths.
- No behavior changes intended; this is a maintainability/readability pass.

### Run: Type Check

- `npm run check` ✅ (0 errors, same existing toggle-group warnings)

### UX Tweak: Multi-Select Remove Control Layout

- Simplified `TagChip` to a visual token-chip component (no embedded remove action).
- Multi-select now renders remove controls as separate sibling buttons to the right of each chip.
- Remove button uses `self-stretch + aspect-square` so target size tracks chip height without fixed width/height values.
- This avoids oversized hover fills inside chips while keeping a larger, explicit remove hitbox.

### Run: Type Check

- `npm run check` ✅ (0 errors, same existing toggle-group warnings)

### Refactor: Token Chips as a Dedicated Reusable Component

- Added `TagChip` at `src/lib/components/ui/badge/tag-chip.svelte` to centralize chip-specific styling and behavior (accent/muted tones, optional removable action, optional leading/trailing snippets).
- Refactored inline multi-select selected items to use `TagChip` instead of custom badge instance classes and inline remove-button wiring.
- Refactored session-related tag/minutes surfaces to use `TagChip` attributes instead of per-instance `Badge class="..."` overrides:
  - `src/lib/components/app/record-card/relation-chip-set.svelte`
  - `src/lib/components/app/home/upcoming-session-card.svelte`
  - `src/lib/components/app/sessions/session-activity-card.svelte`
  - `src/routes/(app)/activity-booklet/[activityId]/+page.svelte`
- Kept `Badge` primitive simple (non-interactive status primitive), with interactive/removable token logic moved into the dedicated chip component.

### Run: Type Check

- `npm run check` ✅ (0 errors, same existing toggle-group warnings)

### Refinement: Reusable Multi-Select UX + A11y

- Moved inline multi-select into reusable UI location: `src/lib/components/ui/multi-select/inline-multi-select.svelte`.
- Updated activity card import to use `src/lib/components/ui/multi-select/index.ts`.
- Improved pointer interaction:
  - clicking anywhere in the control (input/chips area) opens the list and focuses the input caret at the end;
  - chip remove (`x`) remains excluded from open behavior.
- Tuned readability/density:
  - slightly larger multi-select text (`type-body-medium`);
  - tighter vertical spacing with reduced control/chip padding.
- Simplified internals by removing extra focus action/suppression plumbing and using a single pointer handler on the control container.
- Added accessibility attributes (`aria-label`, `aria-haspopup`, `aria-busy`, `aria-invalid`) to improve screen-reader behavior and state signaling.

### Run: Type Check

- `npm run check` ✅ (0 errors, same existing toggle-group warnings)

### UX Refinement: Global Reconnect Overlay + Disabled Inline Editors

- Added persistent global reconnect overlay (`Trying to reconnect…`) with spinner in `AppShell` so connectivity state is communicated consistently across app pages.
- Removed session-local offline alert in favor of the global overlay.
- Session activity cards now keep inline editors visible for edit-capable users while disconnected, but disable interaction:
  - title input disabled,
  - description editor rendered as non-editable read surface,
  - minutes input remains visible and disabled,
  - building blocks multi-select remains visible and disabled.
- Action mutations remain gated by online connectivity checks.

### Run: Type Check

- `npm run check` ✅ (0 errors, same existing toggle-group warnings)

### Feature: Global Connectivity Gate for Editing

- Added shared connectivity module at `src/lib/app/connectivity.ts` with:
  - browser online status tracking,
  - network-health gating for mutation surfaces,
  - shared messaging,
  - mutation success/failure reporting helpers.
- Updated `session-detail-view.svelte` to consume the shared connectivity gate and disable mutation-capable actions (inline activity edits, activity create/edit/delete, drag reorder, session edits, attendance toggles) while offline/unreachable.
- Added an inline alert to explain when editing is unavailable due to connectivity.

### Run: Type Check

- `npm run check` ✅ (0 errors, same existing toggle-group warnings)

### Bug Fix: Building Block Blur Revert Flicker

- Fixed transient “old values flash” after blur in inline building-block editing.
- `inline-multi-select.svelte` now keeps an optimistic committed selection after close and only clears it when Convex-backed props catch up (or on save failure), matching the guard pattern used by other inline fields.

### Run: Type Check

- `npm run check` ✅ (0 errors, same existing toggle-group warnings)
