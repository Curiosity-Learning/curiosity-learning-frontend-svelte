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

### Bug Fix: Feed Query Auth Readiness Race

- Updated `src/routes/(app)/feed/(tabbed)/my-clubs/+page.svelte` to gate `api.updates.listForViewer` behind `api.auth.getCurrentUser`, ensuring the updates query only runs after Convex auth is ready.
- Added explicit UI branches for:
  - Convex auth bootstrap/loading (`Preparing your feed...`),
  - session verification failure,
  - sign-in-required mismatch state.
- This prevents the early `Unauthenticated` server error from surfacing as a stuck loading feed when Better Auth session state appears before Convex identity hydration.

### Run: Type Check

- `npm run check` ✅

### Bug Fix: My Clubs Feed Loading Could Stall Without Visible Error

- Hardened `api.updates.listForViewer` in `src/convex/updates.ts` to tolerate malformed legacy references when resolving related project/question and author profile metadata.
- Added an explicit error branch in `src/routes/(app)/feed/(tabbed)/my-clubs/+page.svelte` so query failures render a destructive alert instead of appearing as a perpetual loading state.

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

### Bug Fix: Session Card Activity Preview Content Mismatch

- Updated `src/lib/components/app/sessions/club-session-card.svelte` so activity preview items no longer fall back to `session.description` when an activity has no notes.
- Activity cards now use an activity-specific fallback label (`No activity notes yet.`), matching the state shown in session detail activity rows.

### Refactor: Club Home Uses Shared Session Card Component

- Replaced the dedicated upcoming-session card usage on club home with the same `ClubSessionCard` component used on `/club/[clubId]/sessions`.
- Added configuration props to `src/lib/components/app/sessions/club-session-card.svelte` so views can vary behavior while sharing the same component:
  - `showAttendeesSection` (dashboard hides attendees),
  - `showActions` (dashboard hides action menu),
  - optional `canReadMembers` and `canDelete`.
- Removed `src/lib/components/app/home/upcoming-session-card.svelte` so the dashboard now renders the shared card implementation directly.

### Bug Fix: Inline Multi-Select First-Option Focus + Query Reset

- Updated `src/lib/components/ui/multi-select/inline-multi-select.svelte` so typing now activates the first filtered option.
- Option selection now clears the typed query text and keeps input focus to support fast repeated selection.
- Keyboard (`Enter`/`Space`) and click paths now share one selection helper so behavior is consistent across interaction modes.
- Replaced optimistic-selection cleanup `$effect` with a derived guard to avoid state assignment inside effects while preserving blur-save behavior.

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

## 2026-02-19

### UI: Reusable Auto-Fit Project Card Grid

- Added reusable `AutoFitCardGrid` at `src/lib/components/app/auto-fit-card-grid.svelte` to encapsulate `repeat(auto-fit, minmax(...))` behavior with a `minColumnWidth` prop.
- Exported the component from `src/lib/components/app/index.ts` for reuse in other app surfaces.
- Updated `src/lib/components/app/projects/club-projects-view.svelte` to render project cards in the reusable auto-fit grid.
- Current and completed project tabs now collapse fluidly from multiple columns down to one based on available width, without route-level media queries.

### Run: Type Check

- `npm run check` ✅ (0 errors, same existing toggle-group warnings)

## 2026-02-20

### Bug Fix: Club Session Route Canonicalization

- Fixed session detail back/fallback navigation to use canonical club session routes, avoiding intermittent 404s on paths like `/:clubId/sessions`.
- Updated `src/lib/components/app/sessions/session-detail-view.svelte` to use `routes.clubSessions(session.clubId)` for:
  - header back fallback target,
  - post-delete redirect target.
- Fixed onboarding success redirects that were also building non-canonical club URLs:
  - `src/routes/onboarding/start-club/+page.svelte`
  - `src/routes/onboarding/join-club/[code]/+page.svelte`
  - both now use `routes.clubHome(result.clubId)`.
- Fixed profile “Club home” shortcut to use canonical club routing:
  - `src/routes/(app)/profile/+page.svelte` now builds the shortcut via `routes.clubHome(activeContext.data.activeClubId)` with `routes.onboardingGetStarted` fallback.

### Run: Type Check

- `npm run check` ✅ (0 errors, same existing toggle-group warnings)

### Bug Fix: Club Home Session Planning Permission + Dialog Intent

- Updated club home upcoming-session empty states so the `Plan a session` CTA only appears for users with `session:create`.
- Hid the helper copy `Plan your next meeting to keep your club moving.` when the viewer lacks `session:create`.
- Wired the empty-state CTA to `/club/[clubId]/sessions?openCreateSession=1` so clicking it opens the create-session dialog on the sessions page.
- Updated `HomeEmptyCard` to support optional descriptions and optional actions, so empty states can render informative-only variants without a button.
- Updated the sessions page create dialog to initialize from the `openCreateSession` query flag and added a create-permission guard on the submit action/button.

### Run: Type Check

- `npm run check` ✅ (0 errors, same existing toggle-group warnings)

### UI Fix: Minutes Input Consistency on Session Detail

- Updated `src/lib/components/app/sessions/session-activity-card.svelte` so minutes now render through one consistent inline number input surface in both editable and non-editable states.
- Removed the non-editable `TagChip` fallback for minutes and now disable the same input when editing is unavailable.
- This keeps the `/session/[sessionId]/activities` card layout and visual treatment consistent across permission/connectivity states.

### Run: Type Check

- `npm run check` ✅ (0 errors, same existing toggle-group warnings)

### UX Update: Plan Session Opens In-Place on Club Home

- Changed the club-home upcoming-session empty-state action to open the create-session dialog directly on `/club/[clubId]` instead of navigating to `/club/[clubId]/sessions`.
- The dialog submit action now matches the sessions page (`Open`) and navigates to the created session at `/session/[sessionId]/activities`.
- Users without `session:create` still see `No upcoming sessions` but do not see the planning helper copy or CTA.

### Run: Type Check

- `npm run check` ✅ (0 errors, same existing toggle-group warnings)

### UX Tweak: Minutes Suffix Rendering

- Updated `src/lib/components/app/sessions/session-activity-card.svelte` to show `mins` as an inline suffix inside the minutes input only when the field has a value.
- Removed placeholder text from the minutes input so the suffix disappears completely when the field is empty.

### UI Tweak: Minutes Input Suffix Spacing + Spinner Removal

- Tightened spacing between minutes value and `mins` suffix in `src/lib/components/app/sessions/session-activity-card.svelte`.
- Removed native number stepper controls (`up/down`) from the minutes input for cleaner in-field suffix rendering.

### UI Tweak: Always-Visible Minutes Unit

- Updated `src/lib/components/app/sessions/session-activity-card.svelte` so the `mins` unit suffix is always visible in the minutes input (not conditional on value/focus).

### Bug Fix: Activity Booklet Tag Filters Require All Selected Tags

- Updated `src/routes/(app)/activity-booklet/+page.svelte` so multi-tag filtering now uses AND matching.
- Selecting multiple building-block tags now only shows activities that include every selected tag, rather than any selected tag.
- Converted `filteredActivities` to `$derived.by(...)` for Svelte 5 compliance and updated template references accordingly.

### Run: Type Check

- `npm run check` ✅ (0 errors, existing toggle-group warnings in `src/lib/components/ui/toggle-group/toggle-group.svelte`)

### UX Default: Dialog Back-Dismiss Enabled by Default

- Updated shared `Dialog.Root` in `src/lib/components/ui/dialog/dialog.svelte` so `closeOnBack` defaults to `true`.
- Dialogs now close on browser/mobile back by default without per-page opt-in wiring.
- Added per-dialog opt-out via `closeOnBack={false}` for edge cases.
- Removed now-redundant explicit `closeOnBack` usage from project edit dialog in `src/lib/components/app/projects/project-detail-view.svelte`.
- Updated docs to reflect default behavior in:
  - `docs/architecture.md`
  - `docs/routing-and-back-navigation.md`

### Run: Type Check

- `npm run check` ✅ (0 errors, existing toggle-group warnings in `src/lib/components/ui/toggle-group/toggle-group.svelte`)

### UX Tweak: Members Tab Heading Removal + Reusable Dialog Back-Dismiss

- Removed the extra `Members` heading text from the project members tab while retaining avatar-based member rows in `src/lib/components/app/projects/project-detail-view.svelte`.
- Added optional component-level back-dismiss behavior to shared dialog root:
  - `src/lib/components/ui/dialog/dialog.svelte` now supports `closeOnBack?: boolean`.
  - When enabled, opening a dialog creates a shallow history entry and browser/mobile back closes the dialog first.
- Enabled this behavior for project edit dialog via `closeOnBack` in `src/lib/components/app/projects/project-detail-view.svelte`.

### Run: Type Check

- `npm run check` ✅ (0 errors, existing toggle-group warnings in `src/lib/components/ui/toggle-group/toggle-group.svelte`)

### Refactor: Project Detail Uses Route-Backed Tabs

- Replaced single-route project detail with tabbed routes:
  - `/project/[projectId]/overview`
  - `/project/[projectId]/members`
  - `/project/[projectId]` now redirects to `/overview`.
- Added project tab header layout using shared app `HeaderTabs` + `PageHeaderBanner`.
- Added shared `src/lib/components/app/projects/project-detail-view.svelte` with `view` prop (`overview`/`members`) so both tabs share project fetch/header/action logic.
- Overview tab now focuses on description/status/updates.
- Members tab now provides a dedicated full member list surface.
- Removed obsolete one-page route file and members-sheet component for this flow.

### Docs

- Added [ADR-008](adr/008-project-detail-tabs.md) documenting the decision and implementation footprint.
- Updated:
  - `docs/architecture.md` (route map + UI pattern note),
  - `docs/README.md` ADR index.

### Run: Type Check

- `npm run check` ✅ (0 errors, existing toggle-group warnings in `src/lib/components/ui/toggle-group/toggle-group.svelte`)

### Feature: Reusable Feed Update Card (Question/Project Aware)

- Added `src/lib/components/app/feed/update-card.svelte` as the shared update presentation card for feed entries.
- Card now supports:
  - author row (avatar, name, relative timestamp),
  - conditional related-question chip,
  - conditional related-project heading/link,
  - update body content.
- Wired `/feed/my-clubs` to use `UpdateCard` instead of inline ad-hoc cards:
  - `src/routes/(app)/feed/(tabbed)/my-clubs/+page.svelte`
- Extended `api.updates.listForViewer` payload to include fields needed by the card:
  - author summary (`authorName`, `authorImageUrl`) from profile lookup,
  - related question context (`questionId`, `questionContent`),
  - existing related project context (`projectId`, `projectName`) preserved.
- Deferred attached media rendering by design for this step; media support will be added in a follow-up iteration.

### Documentation

- Updated `docs/architecture.md` UI patterns with the shared feed update card convention.

### Run: Type Check

- `npm run check` ✅

### Docs: Standardized History-Driven Overlay Pattern

- Updated `docs/routing-and-back-navigation.md` with a dedicated pattern for mobile-back-dismissible overlays:
  - use shallow routing page state (`pushState('', state)`),
  - close with `history.back()` plus `replaceState` fallback,
  - use fully controlled overlay binding (`bind:open={get,set}`) for Bits UI components.
- Updated `docs/architecture.md` UI patterns to codify history-driven overlays as a project convention.
- Expanded `docs/adr/007-history-semantics-for-routing-and-back.md` to include overlay state decision details and implementation references (`project-members-section.svelte`, `src/app.d.ts`).

### Bug Fix: Project Members Sheet Uses Fully Controlled Binding

- Reworked `src/lib/components/app/projects/project-members-section.svelte` sheet control to the Bits UI “fully controlled” pattern with function binding:
  - `bind:open={getMemberSheetOpen, setMemberSheetOpen}`.
- Open now uses shallow routing state via `pushState('', { projectMembersSheetOpen: true })`.
- Close now uses `history.back()` (with `replaceState` fallback) so mobile/browser back reliably dismisses the sheet.
- This replaces prior `open` + `onOpenChange` synchronization logic that caused open/close race behavior.

### Run: Type Check

- `npm run check` ✅ (0 errors, existing toggle-group warnings in `src/lib/components/ui/toggle-group/toggle-group.svelte`)

### Bug Fix: Project Members Sheet Controlled Open State + URL Sync

- Updated `src/lib/components/app/projects/project-members-section.svelte` to remove `bind:open` and use controlled `open={...}` state with `onOpenChange`.
- Sheet open state now derives from:
  - route query state (`?members=1`), plus
  - temporary pending target state while URL updates are in flight.
- This resolves the open-then-close race where the sheet could flash and immediately dismiss on mobile.

### Run: Type Check

- `npm run check` ✅ (0 errors, existing toggle-group warnings in `src/lib/components/ui/toggle-group/toggle-group.svelte`)

### Bug Fix: Project Members Sheet Open Flicker During URL Sync

- Updated `src/lib/components/app/projects/project-members-section.svelte` shallow-routing sync logic with a pending-route guard (`pendingRouteOpen`).
- Prevents immediate re-close flicker when opening the sheet before `pushState` URL updates are reflected in `page.url`.
- Preserves back-button close behavior and query-param driven sheet state.

### Run: Type Check

- `npm run check` ✅ (0 errors, existing toggle-group warnings in `src/lib/components/ui/toggle-group/toggle-group.svelte`)

### Bug Fix: Project Members Sheet Closes on Popstate Back

- Updated `src/lib/components/app/projects/project-members-section.svelte` sheet state wiring:
  - switched from a pure derived `open` flag to local bound state (`bind:open`),
  - added URL -> sheet sync via `$effect` so `page.url` changes from browser/mobile back force-close the sheet,
  - preserved shallow-routing URL behavior (`?members=1`) through `pushState`/`replaceState`.
- Fixes case where URL query was removed by back navigation but the sheet remained visible.

### Run: Type Check

- `npm run check` ✅ (0 errors, existing toggle-group warnings in `src/lib/components/ui/toggle-group/toggle-group.svelte`)

### UX Update: Mobile Pressed State Mirrors Hover

- Updated `src/routes/layout.css` to override Tailwind `hover` variant behavior:
  - keeps standard `:hover` behavior on hover-capable devices,
  - applies `:active` with the same hover classes on coarse-pointer mobile devices.
- This change cascades through shared interactive components without per-component or per-page class rewrites.

### Run: Type Check

- `npm run check` ✅

### UX Refinement: Project Members Sheet Trigger + Back-Driven Close

- Updated `src/lib/components/app/projects/project-members-section.svelte` member trigger styling from `outline` to `ghost`.
- Implemented URL-backed shallow routing for the member sheet using SvelteKit `pushState`/`replaceState` and `$app/state`:
  - opening the sheet sets query state to `?members=1`,
  - closing the sheet clears the query,
  - mobile/browser back now dismisses the sheet instead of navigating away from the project page.

### Run: Type Check

- `npm run check` ✅ (0 errors, existing toggle-group warnings in `src/lib/components/ui/toggle-group/toggle-group.svelte`)

## 2026-02-20

### Refactor: Shared Project Card Component on Club Home + Projects Tabs

- Updated `src/routes/(app)/club/[clubId]/+page.svelte` to reuse `src/lib/components/app/projects/club-project-card.svelte` for the "Current projects" carousel, matching the card component used in `/club/[clubId]/projects/(tabbed)/*`.
- Removed dashboard usage of `project-preview-card.svelte` so project surfaces now share one card implementation.
- Updated card links in the home "Current projects" section to open each project detail route directly (`/project/[projectId]`), making whole-card click behavior consistent with tabbed project lists.

### Run: Type Check

- `npm run check` ✅ (0 errors, existing toggle-group warnings in `src/lib/components/ui/toggle-group/toggle-group.svelte`)

### UI Tweak: Project Card Footer Alignment Across Variable Description Lengths

- Updated shared project card layout in `src/lib/components/app/projects/club-project-card.svelte` so the avatar stack + due/completed row are pinned to the bottom of the card using flex (`mt-auto`).
- Applied `h-full` to card wrappers/content so cards stretch consistently in both grid and horizontal-scroll rows when sibling cards have longer descriptions.
- Result: member avatars and due/completed labels align at the bottom across cards, even when title/description copy lengths vary.

### Run: Type Check

- `npm run check` ✅ (0 errors, existing toggle-group warnings in `src/lib/components/ui/toggle-group/toggle-group.svelte`)

### UI Refactor: Shared Upcoming Session Card + Activity Preview Parity

- Removed the dashboard-specific `src/lib/components/app/home/upcoming-session-card.svelte` and switched club home to reuse `src/lib/components/app/sessions/club-session-card.svelte`, matching `/club/[clubId]/sessions`.
- Added view-config props to `ClubSessionCard` so both routes share one component while varying behavior:
  - `showAttendeesSection` (hidden on dashboard),
  - `showActions` (hidden on dashboard),
  - optional permission props (`canReadMembers`, `canDelete`).
- Updated activity preview content mapping in `ClubSessionCard` so preview descriptions come from each activity record, with `No activity notes yet.` fallback instead of session-level description text.
- Added overflow indicator chip below preview cards for truncated activity lists (`+N more`) while keeping dashboard preview limited to the first 3 activities.
- Updated shared record-card typography and truncation to align with requested hierarchy:
  - date/title: `Body/Default/Bold`,
  - section labels (`Activities`, `Attendees`): `Body/Small/Bold`,
  - activity title: `Body/Default/Bold`,
  - activity description: `Body/Small/Regular`, clipped to one line.
- Tweaked shared header/icon presentation for optical alignment:
  - centered leading-slot wrapper in `data-record-header.svelte`,
  - calendar icon now renders icon-only (no container) with heavier stroke in shared session card.

### Run: Type Check

- `npm run check` ✅ (0 errors, existing toggle-group warnings in `src/lib/components/ui/toggle-group/toggle-group.svelte`)

### UI Tweak: Session Card Typography Hierarchy + Activity Truncation

- Updated session card date/title typography to Body/Default/Bold in:
  - `src/lib/components/app/record-card/data-record-header.svelte`
  - `src/lib/components/app/home/upcoming-session-card.svelte`
- Updated section labels (`Activities`, `Attendees`) to Body/Small/Bold in `src/lib/components/app/record-card/relation-section.svelte`.
- Updated activity item typography in `src/lib/components/app/record-card/relation-list-cards.svelte`:
  - title: Body/Default/Bold (`type-body-bold`)
  - description: Body/Small/Regular (`type-sm`)
  - description truncation: `line-clamp-1`

### UI Update: Upcoming Session Card Shows Activities

- Updated `src/lib/components/app/home/upcoming-session-card.svelte` to remove the attendees section and render up to 3 activities instead.
- Reused the same activity-card renderer from club sessions list by wiring in `RelationListCards`.
- Updated dashboard usage in `src/routes/(app)/club/[clubId]/+page.svelte` to match the new upcoming card props.
- Reduced activity title hierarchy in the shared renderer (`src/lib/components/app/record-card/relation-list-cards.svelte`) from `type-h5-bold` to `type-sm-bold` so titles read as secondary content.

### Run: Type Check

- `npm run check` ✅ (0 errors, existing toggle-group warnings in `src/lib/components/ui/toggle-group/toggle-group.svelte`)

### UX Fix: Attendee Toggle Cursor + Per-Row Pending State

- Updated attendee cards in `src/lib/components/app/sessions/session-detail-view.svelte` to keep `cursor: pointer` on actionable rows and `cursor-not-allowed` only on locked rows.
- Replaced global attendance mutation `pending` usage with per-user pending tracking so toggling one attendee no longer briefly disables every other attendee checkbox.
- Added optimistic attendance state per user so the checkbox updates immediately, then reconciles with server data (pattern aligned with inline multi-select optimistic behavior).
- Removed temporary per-row read-only behavior during save; rapid repeated taps now remain interactive and serialize as latest-intent writes per attendee.
- Kept accessibility behavior intact with full-card label toggling plus explicit checkbox `aria-label` text.

### Run: Type Check

- `npm run check` ✅ (0 errors, same existing toggle-group warnings)

### Bug Fix: Header Back Button Uses In-App Navigation History

- Updated `src/lib/components/app/app-shell.svelte` back-button guard logic to use SvelteKit history index state (`sveltekit:history`) instead of relying on `document.referrer`.
- This restores expected behavior for client-side flows like `Club Dashboard -> All Projects -> Project -> Back`, where back now returns to the previous in-app page rather than falling through to a fallback route (for example, `/feed`).
- Kept fallback behavior in place when no in-app history entry exists.
- Replaced one local `bind:this` reference in the same file with an attachment to satisfy Svelte autofixer guidance.

### Run: Type Check

- `npm run check` ✅ (0 errors, existing toggle-group warnings in `src/lib/components/ui/toggle-group/toggle-group.svelte`)

### Bug Fix: Booklet Add-to-Session History Semantics

- Updated session-origin activity booklet navigation so selecting a booklet activity detail replaces the current booklet list history entry.
- Updated both booklet add actions to return to `/session/[sessionId]/activities` via `goto(..., { replaceState: true })`:
  - `src/routes/(app)/activity-booklet/+page.svelte`
  - `src/routes/(app)/activity-booklet/[activityId]/+page.svelte`
- Added `replaceState` support to the shared clickable card primitive and used it in booklet cards during session-origin flows:
  - `src/lib/components/ui/card/card.svelte`
  - `src/lib/components/app/sessions/booklet-activity-card.svelte`
- Result: after `Add to session`, both header-back and browser-back no longer step back into booklet pages for this flow.

### Run: Type Check

- `npm run check` ✅ (0 errors, existing toggle-group warnings in `src/lib/components/ui/toggle-group/toggle-group.svelte`)

### Bug Fix: Session->Booklet Launch Uses Replace State in Add Flow

- Updated both session detail CTA entry points to activity booklet to navigate with `replaceState: true`:
  - empty-state `Choose from booklet`
  - sticky footer `From booklet`
- File updated: `src/lib/components/app/sessions/session-detail-view.svelte`.
- This removes the original session history entry before booklet flow begins, preventing duplicate `/session/[sessionId]/activities` entries after returning with `Add to session`.

### Run: Type Check

- `npm run check` ✅ (0 errors, existing toggle-group warnings in `src/lib/components/ui/toggle-group/toggle-group.svelte`)

## 2026-02-21

### Bug Fix: Global Convex Auth Readiness Gate (Feed + App Layout)

- Added root auth-state hydration for the Convex Better Auth adapter:
  - `src/routes/+layout.server.ts` now returns `authState` via `getAuthState(createAuth, cookies)`.
  - `src/routes/+layout.svelte` now passes `getServerState` into `createSvelteAuthClient`.
- Added global protected-query gating at app layout level:
  - `src/routes/(app)/+layout.svelte` now uses `useAuth()` and skips protected Convex queries until `!auth.isLoading && auth.isAuthenticated`.
  - App children are now rendered only after auth readiness, preventing early protected child query execution.
- Removed redundant feed-local auth bootstrap patch:
  - `src/routes/(app)/feed/(tabbed)/my-clubs/+page.svelte` no longer calls `api.auth.getCurrentUser` as a preflight gate before `api.updates.listForViewer`.
- Root redirect page now follows the same global auth readiness source:
  - `src/routes/+page.svelte` switched from `authClient.useSession()` gate to `useAuth()`.
- Decision documented in [ADR-009](adr/009-global-convex-auth-readiness-gate.md).

### Run: Validation

- `npm run check` ✅
- `npm run test:quick` ✅
- `npm run lint` ⚠️ blocked by existing repo-wide formatting drift (`prettier --check`) unrelated to this fix.
- `npm run lint:fast` ⚠️ blocked by existing unrelated ESLint errors in other files (for example `src/convex/chat.ts`, `src/convex/sessions.ts`, `src/lib/components/app/sessions/session-detail-view.svelte`).
- `npm run test:e2e` ⚠️ blocked by existing preview build/runtime dependency mismatch:
  - `SyntaxError: The requested module '@better-auth/core/utils' does not provide an export named 'filterOutputFields'`
- `E2E_BASE_URL=http://127.0.0.1:4173 npm run test:e2e:local` ⚠️ one existing test assumption mismatch (`/app/home` URL expectation) unrelated to feed auth readiness.

### Manual QA

- Unauthenticated navigation to `/feed/my-clubs` redirects to `/auth/sign-in?next=%2Ffeed%2Fmy-clubs`.
- During this unauthenticated flow, Convex logs show auth endpoint traffic but no `updates:listForViewer` unauthenticated exception from the feed path.

### Bug Fix: Feed Update Card Null Author Crash

- Fixed a runtime crash in `src/lib/components/app/feed/update-card.svelte` where `authorName` could be null/undefined for legacy update rows, causing `.split()` to throw.
- `UpdateCard` now accepts `authorName?: string | null` and derives a safe fallback display name (`Unknown`) for avatar initials/name rendering.
- Verified with manual login flow to `/feed/my-clubs` that the page now exits the `Loading updates...` state and renders cards instead of crashing.

### Docs: Local Env vs Convex Env Split

- Clarified environment-variable ownership to prevent confusion between local `.env` files and Convex deployment env.
- Updated `.env.example` so it now documents only local app/CLI values plus explicit notes that `RESEND_API_KEY` and `RESEND_FROM` should be set with `npx convex env set ...`.
- Updated `README.md` local setup to separate:
  - local `.env.local` values (`CONVEX_DEPLOYMENT`, Convex public URLs, Better Auth local values),
  - Convex deployment values (`RESEND_API_KEY`, `RESEND_FROM`).

### Docs: Better Auth Ownership Clarification

- Updated `README.md` with an auth runtime note clarifying that Better Auth in this project is a library integration (no separate Better Auth account required).
- Added explicit guidance that `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` should also be set in Convex deployment env (matching local `.env.local` values) to keep SvelteKit and Convex auth runtime configuration aligned.

### Route Boundaries: Server-side Redirect/Gating

- Replaced root client-only redirect shell with server-side route resolution:
  - removed `src/routes/+page.svelte`
  - added `src/routes/+page.server.ts` to redirect `/` to `/onboarding/get-started` or `/club/[clubId]` based on server-side auth + club context.
- Kept auth/onboarding submit flows as SPA/client mutations per established architecture decision:
  - ADR-002 explicitly standardizes `SPA: true` with Convex-backed form handling rather than SvelteKit form actions.

### Run: Type Check

- `npm run check` ✅ (0 errors, existing toggle-group warnings in `src/lib/components/ui/toggle-group/toggle-group.svelte`)

### Rollback: Club Layout Server Guard

- Reverted the club membership guard from server load back to client layout gating after observing perceptible route/back latency from repeated `__data.json` fetches on club navigations.
- Removed `src/routes/(app)/club/[clubId]/+layout.server.ts`.
- Restored client query-based guard in `src/routes/(app)/club/[clubId]/+layout.svelte`.
- Kept root server-side redirect (`src/routes/+page.server.ts`) in place.

### Run: Type Check

- `npm run check` ✅ (0 errors, existing toggle-group warnings in `src/lib/components/ui/toggle-group/toggle-group.svelte`)

### Rollback: Root Server Redirect

- Reverted root routing from server-side redirect back to the prior client-side redirect page to restore immediate in-app navigation responsiveness and `localStorage` remembered-club behavior.
- Removed `src/routes/+page.server.ts`.
- Restored `src/routes/+page.svelte`.

### Run: Type Check

- `npm run check` ✅ (0 errors, existing toggle-group warnings in `src/lib/components/ui/toggle-group/toggle-group.svelte`)

### UI Consistency: Card Shadow Baseline

- Removed default `shadow-sm` from shared card primitive:
  - `src/lib/components/ui/card/card.svelte`
- Removed redundant per-component `shadow-none` overrides now that the baseline is flat:
  - `src/lib/components/app/projects/club-project-card.svelte`
  - `src/lib/components/app/projects/project-detail-view.svelte`
- Result: all cards now share a no-shadow default unless a surface explicitly opts into elevation.

### Run: Validation

- Not run (style-only class changes; no runtime/type logic changes).

## 2026-02-22

### Refactor: Global Convex Query Wrapper Migration

- Added `src/lib/convex/use-stable-query.svelte.ts` with `useStableQuery(...)` as the project-level query hook.
- `useStableQuery` wraps `convex-svelte` `useQuery` and defaults to stale-first behavior (`keepPreviousData: true`) for content continuity during route transitions.
- Migrated app route/component callsites from direct `useQuery` imports to `useStableQuery` across:
  - `src/routes/(app)/**`
  - `src/routes/+page.svelte`
  - `src/routes/onboarding/join-club/[code]/+page.svelte`
  - `src/lib/components/app/**`
- Added ESLint guard in `eslint.config.js` to disallow importing `useQuery` from `convex-svelte` in `src/**` (wrapper file is explicitly exempt).

### Documentation

- Updated `docs/architecture.md` with the new query convention and when to use `{ mode: 'gate' }`.

### Run: Validation

- `npm run check` ✅ (0 errors; existing toggle-group warnings unchanged)

### Bug Fix: Inline Activity Save Failures After Optimistic Refactor

- Hardened `upsertActivity` optimistic patching in `src/lib/components/app/sessions/session-detail-view.svelte` so optimistic callback exceptions do not fail the mutation path.
- Added defensive guards for query cache shape (`Array.isArray`, object/id checks) before patching `api.sessions.listActivities`.
- Normalized `buildingBlockIds` in mutation args to avoid invalid payload values.
- Surfaced inline activity save errors into `activityError` so top-level alert shows the real failure message for easier debugging.

### Run: Validation

- `npm run check` ✅ (0 errors; existing toggle-group warnings unchanged)
- `npm run lint:fast` ⚠️ blocked by existing unrelated ESLint issues already present in the repo

### Bug Fix: Back-Navigation Loading Flash + Slow App Route Transitions

- Updated `src/lib/convex/use-stable-query.svelte.ts` to add module-level in-memory result caching keyed by query + args.
- `useStableQuery` now seeds cached values into `initialData` for `mode: 'content'`, so remounted routes can render previous data immediately while refetching.
- Added `clearStableQueryCache()` and wired auth-boundary invalidation in `src/routes/(app)/+layout.svelte` (cache clears when auth state changes).
- Moved `api.auth.ensureProfile` from blocking server layout load into non-blocking client bootstrap effect in `src/routes/(app)/+layout.svelte`.
- Simplified `src/routes/(app)/+layout.server.ts` to token redirect gating only (removed per-navigation Convex mutation call).

### Run: Validation

- `npm run check` ✅ (0 errors; existing toggle-group warnings unchanged)
- `npx eslint src/lib/convex/use-stable-query.svelte.ts src/routes/(app)/+layout.svelte src/routes/(app)/+layout.server.ts` ✅

### Bug Fix: Club Projects Avatar Pop-in

- Updated `/club/[clubId]/projects` to use `api.projects.listPreviewsByClub` (batched project + member preview payload) instead of `api.projects.listByClub`.
- `ClubProjectsView` now passes `memberPreview` into each `ClubProjectCard`, so card-level `listMembers` queries are skipped and avatars render with initial card content.
- Updated `listPreviewsByClub` in `src/convex/projects.ts` so omitting `limit` returns all projects (home still passes `limit: 6`).

### Run: Validation

- `mcp__svelte__svelte-autofixer` ✅ (`src/lib/components/app/projects/club-projects-view.svelte`)
- `npm run check` ✅ (0 errors; existing toggle-group warnings unchanged)

### Refactor: Remove Remaining Custom Session Optimistic State

- Removed `lastSaved*` optimistic guard state from `src/lib/components/app/sessions/session-activity-card.svelte`; inline name/content/minutes now rely on Convex mutation-level optimistic query updates plus normal remote sync.
- Replaced manual attendance optimistic map/queue in `src/lib/components/app/sessions/session-detail-view.svelte` with `convexClient.mutation(..., { optimisticUpdate })` against `api.sessions.listAttendance`.
- Updated `docs/inline-activity-editing.md` to reflect Convex `optimisticUpdate` as the active pattern for inline activity saves and attendance toggles.

### Run: Validation

- `npm run check` ✅ (0 errors; existing toggle-group warnings unchanged)

### Refinement: Club Projects Tab Remount Cache

- Enabled opt-in memory cache for club projects list query in `src/lib/components/app/projects/club-projects-view.svelte`:
  - `api.projects.listByClub` now uses `useStableQuery(..., { cache: 'memory' })`.
- Scope: affects both `/club/[clubId]/projects/current` and `/club/[clubId]/projects/completed` because both tabs share `ClubProjectsView`.
- Goal: keep project list results visible immediately on remount/back-navigation while the live query refreshes.

### Run: Validation

- `mcp__svelte__svelte-autofixer` ✅ (`club-projects-view.svelte`)
- `npm run check` ✅ (0 errors; existing toggle-group warnings unchanged in `src/lib/components/ui/toggle-group/toggle-group.svelte`)

### Refactor: Inline Multi-Select Optimistic Flow Uses Convex

- Removed component-local optimistic selected-id mirror state from `src/lib/components/ui/multi-select/inline-multi-select.svelte`.
- Added Convex mutation-level optimistic update for inline activity saves in `src/lib/components/app/sessions/session-detail-view.svelte` via `convexClient.mutation(..., { optimisticUpdate })`.
- Optimistic patch now updates the subscribed `api.sessions.listActivities` query cache for the edited activity (`name`, `content`, `minutes`, `buildingBlocks`) while the mutation is in flight.
- Updated `docs/inline-activity-editing.md` to document that building-block immediate UI updates come from Convex `optimisticUpdate`.

### Run: Validation

- `npm run check` ✅ (0 errors; existing toggle-group warnings unchanged)

### Bug Fix: Session Card Tag/Activity Pop-in on Remount

- Added `api.sessions.listCardPreviewsByClub` in `src/convex/sessions.ts` to return session + card preview payload in one query (tags, activity preview, hidden count, optional attendees).
- Updated `src/lib/components/app/sessions/club-session-card.svelte` with `prefetchedCardData` support and nested-query skip behavior when prefetched data is present.
- Migrated both routes to the shared prefetched-card path:
  - `src/routes/(app)/club/[clubId]/+page.svelte`
  - `src/routes/(app)/club/[clubId]/sessions/+page.svelte`
- Result: cards render immediately from prefetched payload when navigating back, without tag/activity delayed hydration from nested card queries.

### Run: Validation

- `npm run check` ✅ (0 errors; existing toggle-group warnings unchanged)
- `npx eslint src/convex/sessions.ts src/lib/components/app/sessions/club-session-card.svelte src/routes/(app)/club/[clubId]/+page.svelte src/routes/(app)/club/[clubId]/sessions/+page.svelte` ✅

### Refinement: Per-Query Opt-in Remount Cache

- Added a per-query cache policy to `useStableQuery` in `src/lib/convex/use-stable-query.svelte.ts`:
  - `cache: 'off' | 'memory'` (default `'off'`).
- Remount cache behavior is now explicit and local to each query instead of globally applied.
- Enabled opt-in memory cache for club-home section content queries in `src/routes/(app)/club/[clubId]/+page.svelte`:
  - `api.sessions.listByClub` (upcoming session preview),
  - `api.projects.listPreviewsByClub`,
  - `api.clubs.getMembers` (learner preview list).
- Goal: keep section content visible on back-navigation for this page while avoiding broad/global cache side effects.

### Run: Validation

- `npm run check` ✅ (0 errors; existing toggle-group warnings unchanged)
- `mcp__svelte__svelte-autofixer` ✅ (`use-stable-query.svelte.ts`, `+page.svelte`)

### Historical Note: Earlier Rollback of First Cache Attempt

- Reverted the module-level cache seeding from `src/lib/convex/use-stable-query.svelte.ts` after a runtime UI regression in navigation/header behavior.
- Reverted auth-boundary cache-clearing hooks from `src/routes/(app)/+layout.svelte`.
- Kept non-blocking profile initialization in app layout and removed per-navigation server `ensureProfile` call from `src/routes/(app)/+layout.server.ts` to preserve faster route transitions without the cache-side regression.

### Run: Validation

- `npm run check` ✅ (0 errors; existing toggle-group warnings unchanged)
- `npx eslint src/lib/convex/use-stable-query.svelte.ts src/routes/(app)/+layout.svelte src/routes/(app)/+layout.server.ts` ✅

## 2026-02-22

### Bug Fix: Project Header Title Flash on Open

- Updated `src/lib/components/app/projects/project-detail-view.svelte` so the header title override is only mounted once a real project title is available.
- Added derived `headerTitle` state that stays `null` during the initial project query load and only falls back to `"Project"` after loading has settled without a name.
- This removes the brief `"Project"` flash when opening a project before the fetched name is applied.

### Run: Validation

- `mcp__svelte__svelte-autofixer` ✅ (`project-detail-view.svelte`)
- `npm run check` ✅ (0 errors; existing toggle-group warnings unchanged in `src/lib/components/ui/toggle-group/toggle-group.svelte`)

### Refinement: Seed Project Header Title From Navigation State

- Added typed generic `App.PageState` fields in `src/app.d.ts` for shell-level title hinting (`headerTitleHint`, `headerTitleHintPath`).
- Updated `src/routes/(app)/+layout.svelte` to apply `headerTitleHint` when the current path matches `headerTitleHintPath`, with priority order:
  - explicit page title override (`PageHeaderTitle`),
  - shell hint from `page.state`,
  - normal nav-derived title.
- Project-open navigation now passes title hints into route state from:
  - project cards in `src/lib/components/app/projects/club-projects-view.svelte`,
  - project cards on club home in `src/routes/(app)/club/[clubId]/+page.svelte`,
  - feed update project links in `src/routes/(app)/feed/(tabbed)/my-clubs/+page.svelte`,
  - create-project “Open” flow in `src/lib/components/app/projects/club-projects-view.svelte`.
- `src/lib/components/app/projects/project-detail-view.svelte` now relies on shell-level hinting and only sets explicit header title after the project query resolves, so fetched canonical project name still wins.
- Updated `src/lib/routes.ts` so `routes.projectDetail(projectId)` now points directly to `/project/{id}/overview` (bypassing the redirect hop).

### Run: Validation

- `npx @sveltejs/mcp svelte-autofixer` ✅
  - `src/lib/components/app/projects/project-detail-view.svelte`
  - `src/lib/components/app/projects/club-project-card.svelte`
  - `src/lib/components/app/projects/club-projects-view.svelte`
  - `src/routes/(app)/club/[clubId]/+page.svelte`
  - `src/lib/components/app/feed/update-card.svelte`
  - `src/routes/(app)/feed/(tabbed)/my-clubs/+page.svelte`
- `npm run check` ✅ (0 errors; existing toggle-group warnings unchanged in `src/lib/components/ui/toggle-group/toggle-group.svelte`)

### UI Refinement: Feed Update Card Project/Prompt Hierarchy

- Updated `src/lib/components/app/feed/update-card.svelte` to match the requested hierarchy:
  - author name now uses `type-body-bold`,
  - timestamp now uses `type-body`,
  - related project now renders as a small default `Badge`,
  - related prompt/question now renders as orange `type-sm-bold` text.
- Added `size` variants (`default`, `sm`) to shared `Badge` in `src/lib/components/ui/badge/badge.svelte` and exported `BadgeSize` in `src/lib/components/ui/badge/index.ts`.
- Updated architecture docs with the feed card convention in `docs/architecture.md`.

### Run: Validation

- `mcp__svelte__svelte-autofixer` ✅
  - `src/lib/components/app/feed/update-card.svelte`
  - `src/lib/components/ui/badge/badge.svelte`
- `npm run check` ✅ (0 errors; existing toggle-group warnings unchanged in `src/lib/components/ui/toggle-group/toggle-group.svelte`)

### UI Refinement: My Clubs Feed Uses Flat List (No Outer Card)

- Updated `src/routes/(app)/feed/(tabbed)/my-clubs/+page.svelte` to remove the outer page `Card` wrapper (`CardHeader`, `CardTitle`, `CardDescription`, `CardContent`).
- The tab now renders loading/error/empty states and `UpdateCard` items directly in a simple vertical list container, avoiding the nested “My clubs inside My clubs” presentation.

### Run: Validation

- `mcp__svelte__svelte-autofixer` ✅ (`src/routes/(app)/feed/(tabbed)/my-clubs/+page.svelte`)

### Refinement: Reusable Header Title Hinting Extended to Sessions

- Extended the shell-level title hint pattern (route-state driven `headerTitleHint`/`headerTitleHintPath`) to session-open flows so session detail headers avoid default-title flash before query hydration.
- Added shared session title formatter `formatSessionHeaderLine` in `src/lib/domain/session.ts` and reused it in both:
  - `src/lib/components/app/sessions/club-session-card.svelte`
  - `src/lib/components/app/sessions/session-detail-view.svelte`
- Added generic navigation-state plumbing to shared clickable cards:
  - `src/lib/components/ui/card/card.svelte` now supports `navigationState` and forwards it to `goto(..., { state })`
  - `src/lib/components/app/record-card/data-record-card.svelte` passes `navigationState` through to `Card`
- Session open coverage now includes:
  - session cards opened from `/club/[clubId]` and `/club/[clubId]/sessions` (via `ClubSessionCard` default navigation state),
  - create-session “Open” navigation from both routes (`src/routes/(app)/club/[clubId]/+page.svelte`, `src/routes/(app)/club/[clubId]/sessions/+page.svelte`).
- Updated architecture guidance in `docs/architecture.md` to document shell-level header hinting and card-driven stateful navigation as the standard reusable pattern.

### Follow-up Fix: Session Title Hint Was Being Overridden During Initial Load

- Updated `src/lib/components/app/sessions/session-detail-view.svelte` to only mount `PageHeaderTitle` once a concrete title is available, matching the project-detail pattern.
- `headerTitle` now resolves to:
  - formatted session timestamp when session data exists,
  - `null` while initial session query is still loading (`isLoading` / `data === undefined`),
  - `"Session"` only after loading completes without a session title source.
- Updated `src/lib/routes.ts` so `routes.sessionDetail(sessionId)` points directly to `/session/{id}/activities` to avoid the `/session/{id}` redirect hop when navigating from cards/links.
- Updated booklet return/open flows to use the canonical helper directly:
  - `src/routes/(app)/activity-booklet/+page.svelte`
  - `src/routes/(app)/activity-booklet/[activityId]/+page.svelte`

### Run: Validation

- `mcp__svelte__svelte-autofixer` ✅ (`session-detail-view.svelte`, `src/routes/(app)/activity-booklet/+page.svelte`, `src/routes/(app)/activity-booklet/[activityId]/+page.svelte`)
- `npm run check` ✅ (0 errors; existing warnings in `toggle-group.svelte` and existing a11y warnings in `src/routes/(app)/club/[clubId]/+page.svelte`)

### Bug Fix: Club Dashboard Project Rail Back-Navigation Scroll Restore

- Updated `src/routes/(app)/club/[clubId]/+page.svelte` to preserve the horizontal scroll position of the “Current projects” rail only when opening a project card from that rail.
- Scroll position is persisted only when `scrollLeft > 0`, matching the requested behavior.
- Restore is one-time on rail mount (value is cleared immediately after applying), so it only supports immediate back-and-forth navigation to project detail pages.

### Run: Validation

- `npm run check` ✅ (0 errors; existing warnings unchanged in `src/lib/components/ui/toggle-group/toggle-group.svelte`)

### Media Uploads: Club Videos + Profile Images (Convex Storage)

- Added Convex storage upload mutation:
  - `src/convex/media.ts` → `media.generateUploadUrl` (auth-gated).
- Extended schema for storage-backed media IDs:
  - `profiles.profileImageStorageId?: Id<'_storage'>`
  - `clubs.videoStorageId?: Id<'_storage'>`
- Updated `src/convex/profiles.ts`:
  - `updateMe` accepts `profileImageStorageId`.
  - resolves storage URL via `ctx.storage.getUrl` and keeps profile/denormalized member avatar fields in sync.
  - `getMe` now resolves profile image URL from `profileImageStorageId` when present.
- Updated `src/convex/clubs.ts`:
  - `createClub` accepts optional `videoUrl` or `videoStorageId`.
  - invite-preview and club responses resolve storage-backed video URL.
- Updated onboarding start-club UI:
  - actual file upload to Convex Storage from `src/routes/onboarding/start-club/+page.svelte`.
  - uploaded `videoStorageId` is submitted with club creation.
- Updated join-club preview UI:
  - `src/routes/onboarding/join-club/[code]/+page.svelte` now renders `<video controls>` when club video is available.
- Updated settings profile UI:
  - `src/routes/(app)/settings/+page.svelte` now supports profile image upload to Convex Storage and saves via `profiles.updateMe`.

### Run: Type Check

- `npm run check` ✅ (0 errors; existing non-blocking toggle-group warnings unchanged)

## 2026-03-12

### UI Polish: Standardized Orange CTA Hover/Pressed States

- Refined shared button interaction styles in `src/lib/components/ui/button/button.svelte`:
  - `brand`: hover darken + pressed darken (`active`) for consistent contained-button feedback.
  - `brand-outline`: hover tint + stronger border + pressed tint for standard outlined-button behavior.
  - added `brand-ghost` for text-CTA style with matching orange hover/pressed feedback.
- Switched Get Started “I have an account” CTA to shared `variant="brand-ghost"` in `src/routes/onboarding/get-started/+page.svelte`.

### UI Refactor: Shared Orange CTA Button Variants

- Added shared button variants in `src/lib/components/ui/button/button.svelte`:
  - `brand` (filled orange CTA),
  - `brand-outline` (orange outline CTA).
- Added shared button size `xl` (`h-12`) for onboarding-style primary actions.
- Updated `src/routes/onboarding/get-started/+page.svelte` to use common variants instead of per-button inline styling:
  - `Join a club` now uses `variant="brand" size="xl"`,
  - `Start a club` now uses `variant="brand-outline" size="xl"`.

### Run: Validation

- `npm run check` ✅ (0 errors; existing warnings unchanged in `src/lib/components/ui/toggle-group/toggle-group.svelte`)

## 2026-03-11

### UI + Typography: Get Started Screen Parity Refresh (Flutter Reference)

- Added `@fontsource/bevan` and updated global font tokens in `src/routes/layout.css`:
  - headings now use `Bevan`,
  - body/controls remain `DM Sans`.
- Rebuilt `src/routes/onboarding/get-started/+page.svelte` to mirror the provided Flutter/UI reference:
  - responsive desktop split layout (illustration + CTA column),
  - mobile stacked layout,
  - logo/header/subtitle/button hierarchy aligned with reference content,
  - primary, outline, and text-only CTA styling aligned with orange theme.
- Wired get-started assets to Flutter-equivalent names:
  - logo: `src/lib/assets/images/login_image.svg`,
  - main illustration: `src/lib/assets/images/image.svg`.

### Run: Validation

- `npm run check` ✅ (0 errors; existing warnings unchanged in `src/lib/components/ui/toggle-group/toggle-group.svelte`)

### Bug Fix: Splash Screen Shows Only Animated App Icon

- Updated `src/lib/components/app/LauncherScreen.svelte` to render only the app icon with no text/content.
- Switched splash icon source to imported `src/lib/assets/favicon.svg` so it uses the same logo as the app favicon and resolves correctly in all builds.
- Added opacity pulse animation and `prefers-reduced-motion` fallback for accessible motion behavior.
- Updated `src/routes/+layout.svelte` launcher timer to run in `onMount` with cleanup, keeping splash timing client-only and predictable.

### Run: Validation

- `npm run check` ✅ (0 errors; existing warnings unchanged in `src/lib/components/ui/toggle-group/toggle-group.svelte`)

## 2026-03-12

### UI: Onboarding Flow Redesign (Join/Start/Signup/Terms)

- Added shared onboarding flow scaffold at `src/lib/components/app/onboarding/flow-shell.svelte` with responsive step counter, progress bar, logo lane (desktop), and account link lane.
- Rebuilt `src/routes/onboarding/join-club/+page.svelte` to match the reference flow:
  - 6-cell invite code entry UX with focus management, paste handling, and disabled/enabled continue state.
  - Mobile-only secondary CTA for `Scan a QR code`.
- Rebuilt `src/routes/onboarding/join-club/[code]/+page.svelte` as the club preview/detail step with media panel, learner/guide sections, and join/apply CTAs while preserving existing Convex join mutation.
- Rebuilt `src/routes/onboarding/start-club/+page.svelte` into responsive 2-step application UI (`Add application details`, `Add video`) with auth-gated final submit and Convex create-club integration for authenticated users.
- Rebuilt `src/routes/auth/sign-up/+page.svelte` into onboarding-style multi-step signup UI (step `3/5` personal info and `4/5` account details), preserving Better Auth email signup and verification resend flow.
- Updated `src/routes/auth/+layout.svelte` so `/auth/sign-up` renders full-page onboarding layout while keeping card layout for other auth routes.
- Updated `src/routes/onboarding/+layout.svelte` to full-bleed white onboarding container.
- Restyled `src/routes/terms/+page.svelte` to the simple mobile/web reference layout with back action and content-first typography.

### Run: Type Check

- `npm run check` ✅
- Residual pre-existing warnings remain in `src/lib/components/ui/toggle-group/toggle-group.svelte` (`state_referenced_locally`), unchanged by this work.

### UX Fix: QR Scan CTA Availability

- Updated `src/routes/onboarding/join-club/+page.svelte` so `Scan a QR code` is shown only when the client appears mobile-like **and** has camera API support (`mediaDevices/getUserMedia`).
- This removes scan CTA on normal desktop/laptop web by default while keeping it available on mobile web devices that can scan.

### Run: Type Check

- `npm run check` ✅

### Refactor: Shared Onboarding/Auth Form Components

- Added reusable form primitives in `src/lib/components/app/form/`:
  - `FieldShell`
  - `InputField`
  - `TextareaField`
  - `SelectField`
  - `DateSelectField`
- Refactored onboarding/auth screens to reuse shared form components instead of ad-hoc label/input/select markup:
  - `src/routes/onboarding/start-club/+page.svelte`
  - `src/routes/auth/sign-up/+page.svelte`
  - `src/routes/auth/sign-in/+page.svelte`
  - `src/routes/auth/reset-password/+page.svelte`

### Run: Type Check

- `npm run check` ✅

### UI Consistency: Step Header Typography

- Added shared `.type-step-title` typography token in `src/routes/layout.css` with:
  - `font-family: DM Sans`
  - `font-weight: 700`
  - `font-size: 20px`
  - `line-height: 24px`
  - `letter-spacing: 0`
- Applied this class to step headers in:
  - `src/routes/onboarding/join-club/+page.svelte`
  - `src/routes/onboarding/join-club/[code]/+page.svelte`
  - `src/routes/onboarding/start-club/+page.svelte`
  - `src/routes/auth/sign-up/+page.svelte`

### Run: Type Check

- `npm run check` ✅

### UI Consistency: Text Field Label Typography

- Added shared `.type-field-label` typography token in `src/routes/layout.css` with:
  - `font-family: DM Sans`
  - `font-weight: 700`
  - `font-size: 16px`
  - `line-height: 24px`
  - `letter-spacing: 0`
- Updated shared form label wrapper (`src/lib/components/app/form/field-shell.svelte`) to use `.type-field-label` by default.
- Removed custom larger label override from `src/routes/onboarding/start-club/+page.svelte` so it inherits the common field-label typography.

### Run: Type Check

- `npm run check` ✅

### Theme Alignment: Primary Orange Button/Link Color

- Updated shared button variants in `src/lib/components/ui/button/button.svelte` so onboarding-focused button styles use primary orange (`#F5791D` / `orange-500`) as the default accent color:
  - `brand-outline` now defaults to orange-500 for border/text.
  - `brand-ghost` now defaults to orange-500 text.
- Updated onboarding/account accent links to primary orange-500 for consistency:
  - `src/lib/components/app/onboarding/flow-shell.svelte` (`I have an account` link)
  - `src/routes/onboarding/join-club/+page.svelte` (`View public clubs near you.`)
  - `src/routes/auth/sign-up/+page.svelte` (`Terms and conditions` link)
  - `src/routes/onboarding/join-club/[code]/+page.svelte` location/time badges.

### Run: Type Check

- `npm run check` ✅

### Join Club: Code Validation via getClubPreviewByCode

- Updated `src/routes/onboarding/join-club/+page.svelte` to call `api.clubs.getClubPreviewByCode` before navigating to the preview step.
- `Continue` now validates the 6-character club code against existing clubs and shows inline error messaging for invalid/unresolvable codes.
- Added loading state (`Checking...`) while validation is in progress.

### Run: Type Check

- `npm run check` ✅

### Signup: OTP Email Verification Flow

- Switched signup email verification from link-based to OTP-based verification using Better Auth `emailOTP` plugin.
- Added email OTP server plugin setup in `src/convex/auth.ts` with Resend delivery for:
  - `email-verification`
  - `sign-in`
  - `forget-password`
- Enabled OTP auto-send on signup via Better Auth `emailVerification.sendOnSignUp` with default email-verification override (`overrideDefaultEmailVerification`).
- Added `emailOTPClient()` to `src/lib/auth-client.ts`.
- Completed signup flow UI in `src/routes/auth/sign-up/+page.svelte`:
  - Added `5/5` email verification step with 6-digit OTP entry.
  - Added OTP verify action (`authClient.emailOtp.verifyEmail`).
  - Added OTP resend action (`authClient.emailOtp.sendVerificationOtp`) with 30s cooldown.
  - Kept onboarding step progression and responsive layout intact.

### Run: Type Check

- `npm run check` ✅ (existing non-blocking `toggle-group` warnings unchanged)

### Onboarding: Start Club Back Navigation Fix

- Fixed incorrect back behavior in `src/routes/onboarding/start-club/+page.svelte` where returning from step 1 could bounce users back to step 2.
- Step navigation is now URL-driven (`/onboarding/start-club` for step 1 and `/onboarding/start-club?step=2` for step 2).
- Back from step 2 now replaces URL history to step 1, and back from step 1 always routes to `/onboarding/get-started`.

### Run: Type Check

- `npm run check` ✅ (existing non-blocking toggle-group warnings unchanged)

### Clubs Media Storage: Persist `videoStorageId` Only

- Updated `clubs` table schema to stop persisting raw `videoUrl` and store only `videoStorageId` for uploaded videos.
- Updated `src/convex/clubs.ts`:
  - removed `videoUrl` write args from `createClub` and `updateClub`
  - removed raw-url fallback from `resolveClubVideoUrl`
  - keeps returning resolved `videoUrl` in read responses by calling `ctx.storage.getUrl(videoStorageId)` when present
- Updated onboarding start-club submit flow (`src/routes/onboarding/start-club/+page.svelte`) to send only `videoStorageId`.
- Updated start-club step copy/UI to remove external link input and focus on upload-based video submission.
- Regenerated Convex bindings with `npm run convex:codegen`.

### Run: Validation

- `npm run check` ✅ (0 errors; existing non-blocking toggle-group warnings unchanged)

## 2026-03-16

### Login Desktop Layout Refinement: Show Login SVG on Laptop + Align with Figma Composition

- Updated `src/routes/auth/sign-in/+page.svelte`:
  - moved to a centered two-column desktop composition with compact card-like structure
  - desktop illustration now appears from `md` breakpoint (instead of only `lg`)
  - left panel wraps `src/lib/assets/svg/login.svg` in a light-orange rounded container
  - adjusted top logo/link visibility and spacing to better match provided login references
- Result: login illustration now renders on typical laptop widths and overall screen hierarchy is closer to the design screenshots.

### Run: Validation

- `npm run check` ✅ (0 errors; existing non-blocking toggle-group warnings unchanged)

## 2026-03-16

### Auth UI Update: New Login + Forgot/Reset Password Screens (Figma-Aligned)

- Updated auth layout routing in `src/routes/auth/+layout.svelte` so:
  - `/auth/sign-in` and `/auth/reset-password` render in full-screen white layout mode (no legacy auth card wrapper)
- Rebuilt login screen in `src/routes/auth/sign-in/+page.svelte`:
  - desktop left-side illustration uses `src/lib/assets/svg/login.svg`
  - top branding + "I'm new, sign me up" CTA
  - username/email + password fields
  - remember-me checkbox
  - forgot-password link to reset flow
  - login + sign-up buttons
  - preserved verification resend behavior for unverified-email sign-in errors
- Rebuilt reset flow screen in `src/routes/auth/reset-password/+page.svelte` with three states:
  - request reset link (username/email + reset button)
  - reset link sent confirmation (uses `src/lib/assets/reset_password.png`)
  - create new password form (new/confirm password + save changes)
  - added optional parent-flow messaging support via `?parent=1`
  - successful password reset shows snackbar and routes back to sign-in

### Run: Validation

- `npm run check` ✅ (0 errors; existing non-blocking toggle-group warnings unchanged)

## 2026-03-16

### Unified Dropdown UX in Start Club Step 1

- Added shared form component:
  - `src/lib/components/app/form/dropdown-field.svelte`
  - supports input-style dropdown with menu opening below field, loading state, click-outside close, searchable/non-searchable modes
- Updated form exports:
  - `src/lib/components/app/form/index.ts` now exports `DropdownField`
- Updated `src/routes/onboarding/start-club/+page.svelte`:
  - location field now uses `DropdownField` with Photon suggestions
  - `I am a...` and `How did you find out about us?` now also use `DropdownField` (non-searchable)
- Result: all three dropdowns in this step now share consistent styling and behavior.

### Run: Validation

- `npm run check` ✅ (0 errors; existing non-blocking toggle-group warnings unchanged)

## 2026-03-16

### Start Club Location Field: Photon (Free OSM) Autocomplete Integration

- Updated `src/routes/onboarding/start-club/+page.svelte` to replace plain location input behavior with Photon-backed autocomplete:
  - debounced client-side search against `https://photon.komoot.io/api/`
  - dropdown suggestions with click-to-select
  - loading spinner during lookup
  - deduplicated label formatting from Photon place properties
  - graceful fallback to manual typing if lookup fails
- Added click-outside behavior to close the dropdown and abort/cleanup lookup timers/controllers on state changes and unmount.

### Run: Validation

- `npm run check` ✅ (0 errors; existing non-blocking toggle-group warnings unchanged)

## 2026-03-16

### Start Club Step 1: Referral Dropdown + Conditional "Other" Field + Desktop No-Scroll Option

- Updated `src/routes/onboarding/start-club/+page.svelte`:
  - changed "How did you find out about us?" from free-text input to a dropdown with source options
  - added conditional "Please specify" input that appears only when `Other` is selected
  - added common social/source options (Instagram, LinkedIn, Facebook, YouTube, X, Friend/family, School/teacher, Event/workshop, Other)
- Updated shared onboarding shell `src/lib/components/app/onboarding/flow-shell.svelte`:
  - added `desktopContentScrollable` prop (default `true`)
  - Start Club flow now sets `desktopContentScrollable={false}` to avoid internal desktop scroll for this step

### Run: Validation

- `npm run check` ✅ (0 errors; existing non-blocking toggle-group warnings unchanged)

## 2026-03-16

### Post-Signup Redirect Fix: Prevent Bounce to Get Started After Pledge Acceptance

- Updated `src/routes/auth/sign-up/+page.svelte` to preserve the original `nextPath` when routing into post-signup, instead of hardcoding `next=/`.
- Updated `src/routes/onboarding/post-signup/+page.svelte` completion logic:
  - if profile has `pendingClubCode`, it now calls `api.clubs.joinClubWithCode` and routes directly to `/club/{clubId}`
  - otherwise it keeps existing `firstLoginCompleted` update + `nextPath` redirect
- Result: users coming from join-club signup flow are taken to club/home after accepting pledges, instead of landing on get-started.

### Run: Validation

- `npm run check` ✅ (0 errors; existing non-blocking toggle-group warnings unchanged)

## 2026-03-16

### Post-Signup UX: Replaced Inline Alerts with Global Snackbar Feedback

- Updated `src/routes/onboarding/post-signup/+page.svelte`:
  - removed static inline alert UI blocks
  - switched success/error/validation feedback to `showGlobalSnackbar(...)`
  - includes upload success, invalid file type, pledge load errors, username required, and onboarding completion errors
- Goal: keep the step UI clean and show transient feedback consistently across web/mobile.

### Run: Validation

- `npm run check` ✅ (0 errors; existing non-blocking toggle-group warnings unchanged)

## 2026-03-16

### Onboarding UI Cleanup: Removed Header Logo from Step Shell

- Updated `src/lib/components/app/onboarding/flow-shell.svelte` to remove the Curiosity Learning logo from the onboarding step header on web.
- Cleaned up header grid layout after logo removal while preserving progress bar and account-link alignment.

### Run: Validation

- `npm run check` ✅ (0 errors; existing non-blocking toggle-group warnings unchanged)

## 2026-03-16

### OTP UX/Sync Fix: Remove OTP Field Blinking + Improve Session Hydration Reliability

- Updated `src/routes/auth/sign-up/+page.svelte` email OTP finalization behavior:
  - increased retry window for session hydration (`30` attempts, `800ms` delay),
  - added active session refresh check via `authClient.getSession()` before deciding session is unavailable.
- Removed repeated `pending` toggles during post-OTP finalization to avoid UI flicker.
- Added a unified OTP sync state (`otpSyncInProgress`) and applied it to:
  - OTP input disabled/cell styles,
  - verify button disabled/loading label,
  - change-email / resend actions.
- Result: OTP cells no longer blink while verifying/finalizing, and false "Session sync is taking too long" errors are less likely during normal auth hydration delays.

### Run: Validation

- `npm run check` ✅ (0 errors; existing non-blocking toggle-group warnings unchanged)

## 2026-03-16

### Join Flow UX: "Join as a learner" No Longer Auto-Uses Existing Session

- Updated `src/routes/onboarding/join-club/[code]/+page.svelte` so the CTA now always routes into signup flow (DOB/account steps), instead of directly running join mutation when a session exists.
- Added explicit `forceSignup=1` on signup redirect from join flow and signed out any existing session before redirect, to prevent implicit account reuse.
- Updated `src/routes/auth/sign-up/+page.svelte` to preserve `forceSignup` across step/terms navigation and skip automatic `session -> nextPath` redirect while `forceSignup=1` is active.
- This prevents “auto logging in” when user taps join from club detail onboarding.

### Run: Validation

- `npm run check` ✅ (0 errors; existing non-blocking toggle-group warnings unchanged)

## 2026-03-16

### OTP Finalization Reliability: Bounded Retry + No Infinite Loading Loop

- Updated `src/routes/auth/sign-up/+page.svelte` OTP post-verification finalization flow to prevent repeated `auth:ensureProfile` spam and stuck loading states.
- Added controlled retry queue for email post-verify completion:
  - delayed retries (`EMAIL_POST_VERIFY_RETRY_DELAY_MS`),
  - max attempt cap (`EMAIL_POST_VERIFY_MAX_ATTEMPTS`),
  - timer guards to prevent concurrent retry loops.
- Added explicit state reset helper for post-verify flow to avoid stale retry flags on back/change navigation.
- Added in-screen info alert for OTP verification status (`Email verified. Finalizing your account...`).
- Verify button now disables and shows `Finalizing` during session/profile synchronization.
- On repeated session sync failure, users now receive clear guidance instead of indefinite loading (`Please sign in again and continue.`).

### Run: Validation

- `npm run check` ✅ (0 errors; existing non-blocking toggle-group warnings unchanged)

## 2026-03-16

### Join Club Backend Fix: Auto-Create Missing Profile for Authenticated Users

- Fixed `Profile not found` crash in `clubs:joinClubWithCode` when an authenticated user has no `profiles` row yet.
- Updated `src/convex/clubs.ts`:
  - added mutation-only `getOrCreateProfile` helper that creates a minimal profile from Better Auth user data when missing,
  - added `resolveUniqueUsername` safeguard for generated username collisions,
  - switched `createClub`, `joinClubWithCode`, and `switchActiveClub` to use `getOrCreateProfile`.
- Hardened `getActiveClubContext` query to return empty context instead of throwing when profile is absent.

### Run: Validation

- `npm run check` ✅ (0 errors; existing non-blocking toggle-group warnings unchanged)

## 2026-03-16

### Join Club Onboarding: Handle Convex Auth Hydration Race on "Join as a learner"

- Updated `src/routes/onboarding/join-club/[code]/+page.svelte` join handler to avoid surfacing raw `Unauthenticated` server errors when Better Auth session exists but Convex identity is still hydrating.
- New behavior on "Join as a learner":
  - if not signed in, route to sign-up with `next` back to the same join-club code page,
  - if mutation fails with `Unauthenticated`, retry once after a short delay,
  - if still unauthenticated, redirect to sign-up flow instead of showing backend error text.
- Keeps existing direct success path for fully authenticated users.

### Run: Validation

- `npm run check` ✅ (0 errors; existing non-blocking toggle-group warnings unchanged)

## 2026-03-16

### Signup UX Fix: Existing Unverified Email Now Resends OTP Instead of Blocking

- Updated `src/routes/auth/sign-up/+page.svelte` signup handling for the "email already exists" case:
  - if signup detects an existing account, the flow now attempts `email-verification` OTP resend,
  - on resend success, user is moved to verification step (`step 5`) with fresh code prompt and cooldown.
- This fixes the change-email/back-and-continue path where users could see a false-end error even when they only needed to verify OTP.
- Added fallback handling:
  - if email is already fully verified, show clear guidance to sign in instead.

### Run: Validation

- `npm run check` ✅ (0 errors; existing non-blocking toggle-group warnings unchanged)

## 2026-03-16

### OTP Verification Race Fix: Delay Profile Completion Until Session Hydrates

- Fixed email OTP verification race in `src/routes/auth/sign-up/+page.svelte` where Convex profile mutations could run before auth session hydration, causing:
  - `Uncaught ConvexError: Unauthenticated` in `auth:ensureProfile`.
- Added guarded post-OTP completion flow:
  - mark verification as complete,
  - wait for authenticated session availability,
  - finalize profile setup only after session is present.
- Added in-flight guards to avoid duplicate profile completion attempts.
- Kept user on the verify step with a clear interim message while session finalizes.
- Reset post-verify flags when navigating back/change to keep step transitions consistent.

### Run: Validation

- `npm run check` ✅ (0 errors; existing non-blocking toggle-group warnings unchanged)

## 2026-03-16

### Theme Consistency: Checkbox Checked State Uses Primary Orange

- Updated shared checkbox component in `src/lib/components/ui/checkbox/checkbox.svelte` so checked state now uses primary orange (`#F5791D`) consistently:
  - `data-[state=checked]:bg-orange-500`
  - `data-[state=checked]:border-orange-500`
  - checked icon color set to white
- Updated checkbox focus styles to orange ring/border for consistent interaction styling.

### Run: Validation

- `npm run check` ✅ (0 errors; existing non-blocking toggle-group warnings unchanged)

## 2026-03-16

### Signup UI Polish: Password Field Fill + Eye Toggle Interaction

- Updated password and confirm-password fields in `src/routes/auth/sign-up/+page.svelte` to use white input fill (`inputClass="bg-white"`).
- Refined show/hide-password icon button behavior for cleaner interaction:
  - removed focus/hover border/ring artifacts around the eye icon,
  - preserved input focus on icon press for smoother typing flow (`onmousedown` prevent-default),
  - added `aria-pressed` state for the visibility toggle buttons.

### Run: Validation

- `npm run check` ✅ (0 errors; existing non-blocking toggle-group warnings unchanged)

## 2026-03-16

### Signup UI: Removed Username Field from Account Details Step

- Updated `src/routes/auth/sign-up/+page.svelte` to remove the username input from the "Enter your account details" screen.
- Updated signup payload construction to derive `name` from the email local part (with safe fallback) for `authClient.signUp.email`.
- Updated profile completion call to no longer pass a username from this step.
- Updated sign-up button disabled-state validation to require only email + password + confirm password.

### Run: Validation

- `npm run check` ✅ (0 errors; existing non-blocking toggle-group warnings unchanged)

## 2026-03-16

### Club Dashboard Theme Alignment: Chip Component + Primary Orange Consistency

- Updated shared chip styling in `src/lib/components/ui/badge/tag-chip.svelte`:
  - added `primary` (filled orange) tone
  - added `primarySoft` tone using light orange background (`#FEF2E8`)
  - kept `accent` as a supported tone and mapped it to the same light-orange visual treatment
- Updated `src/lib/components/app/record-card/relation-chip-set.svelte` tone typing to accept the new chip tone variants.
- Aligned club dashboard surface colors to primary orange:
  - `View all` action links now use explicit orange in `src/lib/components/app/home/home-action-link.svelte`
  - empty-state card icons now use light-orange background + orange icon in `src/lib/components/app/home/home-empty-card.svelte`
  - session and project calendar icons now use orange in:
    - `src/lib/components/app/sessions/club-session-card.svelte`
    - `src/lib/components/app/projects/club-project-card.svelte`
  - invite learner trigger link now uses orange in `src/lib/components/app/home/invite-learner-dialog.svelte`
  - avatar overflow counter pill now uses light-orange + orange text in `src/lib/components/app/home/avatar-stack.svelte`
  - project preview card calendar icon updated to orange in `src/lib/components/app/home/project-preview-card.svelte`

### Run: Validation

- `npm run check` ✅ (0 errors; existing non-blocking `toggle-group` warnings unchanged)

### Video Rendering Guard: Valid Video Only

- Updated onboarding club detail screen (`src/routes/onboarding/join-club/[code]/+page.svelte`) to render the video player only when a valid HTTP(S) video URL is present and media loading succeeds.
- Removed fallback poster/play overlay from that screen so no video UI appears when no valid club video exists.
- Updated onboarding start-club step (`src/routes/onboarding/start-club/+page.svelte`) to:
  - accept only files with `video/*` MIME type,
  - render preview video only after successful upload (`videoStorageId`) and successful media load.

### Run: Validation

- `npm run check` ✅ (0 errors; existing non-blocking toggle-group warnings unchanged)

## 2026-03-15

### Accessibility Baseline

- Added global accessibility/disability-support defaults:
  - keyboard skip link to main content in root layout
  - semantic `<main id="main-content">` landmark
  - focus-visible ring styles for keyboard navigation
  - reduced motion fallback for users with `prefers-reduced-motion`

### Run: Type Check

- `npm run check` ✅ (0 errors; existing non-blocking toggle-group warnings unchanged)

### Convex: Removed Legacy `clubCodes` Table

- Removed `clubCodes` table from `src/convex/schema.ts`.
- Updated invite-code flows in `src/convex/clubs.ts` to use only `clubs.clubCode`:
  - invite code generation uniqueness check
  - join/preview by code resolution
  - club payloads (`getMyClubs`, `getClubById`)
  - club creation (no dual-write to legacy table)
- Updated `src/convex/bootstrap.ts` `seedClubCode84NPWT` to use only `clubs.clubCode`.
- `clubs.clubCode` is now the single source of truth for club invite codes.

### Run: Type Check

- `npm run check` ✅ (existing non-blocking toggle-group warnings unchanged)

### Legal Docs: Unified Table + Cookie Policy Page

- Added a new Convex `legalDocuments` table in `src/convex/schema.ts` to store legal content by full-name document type:
  - `Privacy Policy`
  - `Terms and Conditions`
  - `Cookie Policy`
- Added `src/convex/legalDocuments.ts` with:
  - `getActiveByKey`
  - `listActive`
  - `upsertActive`
- Updated bootstrap seeding in `src/convex/bootstrap.ts` to ensure active defaults exist for all three legal documents.
- Updated public legal routes to read from `legalDocuments`:
  - `src/routes/privacy/+page.server.ts`
  - `src/routes/terms/+page.server.ts`
  - new `src/routes/cookies/+page.server.ts`
- Added shared Terms-style legal UI component:
  - `src/lib/components/app/legal/legal-document-screen.svelte`
- Migrated Privacy and Terms pages to the shared legal-document UI and added a new Cookie Policy page:
  - `src/routes/privacy/+page.svelte`
  - `src/routes/terms/+page.svelte`
  - `src/routes/cookies/+page.svelte`
- Updated cookie consent banner links to include Cookie Policy and full legal names.
- Updated settings policy section to show all legal document types and direct links to each page.

### Run: Type Check

- `npm run check` ✅ (existing non-blocking toggle-group warnings unchanged)

### Cookies: Delayed Popup on Get Started

- Updated `src/lib/components/app/cookie-consent-banner.svelte` so cookie consent popup appears with a short delay (`1500ms`) after user reaches `/onboarding/get-started`.
- Popup now stays hidden on other routes by default and still respects previously saved consent.

### Run: Type Check

- `npm run check` ✅ (existing non-blocking toggle-group warnings unchanged)

### Cookies: Essential + Functional Only

- Updated `src/lib/components/app/cookie-consent-banner.svelte` to support only two cookie categories:
  - essential (always on)
  - functional (user choice)
- Removed `Accept all` wording and replaced with:
  - `Essential only`
  - `Allow functional cookies`
- Updated consent persistence keys/formats:
  - localStorage: `cl_cookie_preferences_v1` (JSON)
  - cookie: `cl_cookie_preferences` (`essential_only` or `essential_functional`)
- Added backward compatibility mapping for previous values (`accepted` / `declined`).

### Run: Type Check

- `npm run check` ✅ (existing non-blocking toggle-group warnings unchanged)

### Web: Global Cookie Consent Popup

- Added website-style cookie consent popup component at `src/lib/components/app/cookie-consent-banner.svelte`.
- Popup appears once, allows:
  - `Accept all`
  - `Essential only`
- Consent is persisted in both:
  - localStorage key: `cl_cookie_consent_v1`
  - cookie: `cl_cookie_consent`
- Mounted globally in `src/routes/+layout.svelte` (shown after launcher screen) so it works across all routes.

### Run: Type Check

- `npm run check` ✅ (existing non-blocking toggle-group warnings unchanged)

### Convex: clubs.clubCode + Fixed Test Code Seed

- Added `clubCode` column to `clubs` table schema and index:
  - `clubCode: v.optional(v.string())`
  - `.index('by_club_code', ['clubCode'])`
- Updated club backend to persist and read from `clubs.clubCode` while keeping compatibility with legacy `clubCodes` table:
  - invite code generation now checks both `clubs` and `clubCodes` for uniqueness
  - `createClub` writes generated invite code into both `clubs.clubCode` and `clubCodes`
  - code-based preview/join now resolves by `clubs.clubCode` first, then falls back to `clubCodes`
  - `getMyClubs` and `getClubById` prefer `clubs.clubCode` with legacy fallback
- Added `seedClubCode84NPWT` mutation in `src/convex/bootstrap.ts` to ensure code `84NPWT` exists and is synced in both tables (idempotent behavior).

### Run: Type Check

- `npm run check` ✅ (existing non-blocking toggle-group warnings unchanged)

### Onboarding: Removed Visible Step Counter Text

- Updated shared onboarding shell `src/lib/components/app/onboarding/flow-shell.svelte` to remove the visible `step/total` text (e.g., `1/5`) from the header.
- Kept the progress bar behavior unchanged across onboarding and auth step flows.

### Run: Type Check

- `npm run check` ✅ (existing non-blocking toggle-group warnings unchanged)

### Auth: Resend Verification + Shared OTP Component

- Confirmed auth email OTP delivery is wired through Resend in `src/convex/auth.ts`:
  - `sendVerificationOTP` for `email-verification`, `sign-in`, and `forget-password`
  - password reset email (`sendResetPassword`)
  - required env: `RESEND_API_KEY` (optional sender override: `RESEND_FROM`)
- Added shared `InputOtp` UI primitive in `src/lib/components/ui/input-otp/` built on `bits-ui` `PinInput` (shadcn-style component approach).
- Refactored signup step `5/5` in `src/routes/auth/sign-up/+page.svelte` to use `InputOtp` and removed custom per-cell OTP keyboard/paste handlers.
- Kept existing resend cooldown and OTP verify flow behavior intact.

### Run: Type Check

- `npm run check` ✅ (existing non-blocking toggle-group warnings unchanged)

### Onboarding: Join Club Initial Steps Restored

- Updated `src/routes/onboarding/get-started/+page.svelte` so both `Join a club` and `Start a club` always enter onboarding flows first instead of sending unauthenticated users directly to sign-up.
- This restores the expected Join Club sequence visibility:
  - Step 1: enter club code (`/onboarding/join-club`)
  - Step 2: club details (`/onboarding/join-club/[code]`)

### Run: Type Check

- `npm run check` ✅ (existing non-blocking toggle-group warnings unchanged)

### Convex Seed: Dummy Club Mutation

- Added `seedDummyClub` mutation in `src/convex/bootstrap.ts` to insert a dummy row in `clubs` table (plus matching `clubCodes` row).
- Defaults:
  - name: `Demo Curiosity Club`
  - code: `CLUB01`
  - location: `Amsterdam`
  - meeting: `Wednesdays 4:00 pm`
- Mutation is idempotent by invite code (returns existing club if code already exists).

### Run: Type Check

- `npm run check` ✅ (existing non-blocking toggle-group warnings unchanged)

### Signup DOB: Month + Year Only

- Updated signup DOB flow to remove day selection and capture only month and year.
- Extended shared `DateSelectField` with `includeDay` prop (default `true`) and used `includeDay={false}` in signup.
- Updated signup personal-step validation to require only name + birth month + birth year.

### Run: Type Check

- `npm run check` ✅ (existing non-blocking toggle-group warnings unchanged)

### Signup: Age-Gated Google Sign Up (Step 4)

- Updated `src/routes/auth/sign-up/+page.svelte` to show a `Sign up with Google` CTA on account-details step only when user age is over 16.
- Added `signUpWithGoogle` flow using Better Auth social sign-in:
  - `authClient.signIn.social({ provider: 'google', callbackURL, newUserCallbackURL, requestSignUp: true })`
- Kept terms acceptance requirement for Google sign-up path for consistency with email sign-up flow.

### Run: Type Check

- `npm run check` ✅ (existing non-blocking toggle-group warnings unchanged)

## 2026-03-15

### Onboarding Layout: Desktop Illustration + Mobile-Style Form Column

- Updated shared onboarding shell `src/lib/components/app/onboarding/flow-shell.svelte` with optional `showSideIllustration` support.
- Enabled desktop left-side illustration (same asset as get-started: `assets/images/image.svg`) for:
  - `src/routes/onboarding/join-club/+page.svelte`
  - `src/routes/onboarding/join-club/[code]/+page.svelte`
  - `src/routes/onboarding/start-club/+page.svelte`
- Right panel remains the same mobile-style step UI and stays responsive on smaller screens.

### Run: Type Check

- `npm run check` ✅ (0 errors; existing non-blocking toggle-group warnings unchanged)

## 2026-03-15

### Date/Time Helpers: Reusable Weekly Meeting Label Formatter

- Added reusable format helpers in `src/lib/domain/date.ts`:
  - `formatMeetingTime(value)`
  - `formatWeeklyMeetingLabel(day, time)`
- Refactored `src/routes/onboarding/join-club/[code]/+page.svelte` to use `formatWeeklyMeetingLabel` instead of local inline formatting logic.
- Added unit test coverage in `src/lib/domain/date.spec.ts` for:
  - 24-hour to am/pm conversion
  - weekday pluralization + `"at"` separator output
  - partial input handling.

### Run: Validation

- `npm run test:quick -- src/lib/domain/date.spec.ts` ✅
- `npm run check` ✅ (0 errors; existing non-blocking toggle-group warnings unchanged)

## 2026-03-15

### Onboarding Club Detail: Removed Member/Project Sections

- Updated `src/routes/onboarding/join-club/[code]/+page.svelte` to remove Learners/Guides display from onboarding club detail UI.
- The onboarding club detail step now focuses on title, description, location/time, optional video, and CTA actions only.

### Run: Validation

- `npm run check` ✅ (0 errors; existing non-blocking toggle-group warnings unchanged)

## 2026-03-15

### Onboarding Join CTA: Unauthenticated Path to Signup (DOB Step)

- Fixed onboarding join-club detail CTA in `src/routes/onboarding/join-club/[code]/+page.svelte`.
- `Join as a learner` now routes unauthenticated users to `/auth/sign-up` (with `next` back to join-club code page) instead of `/auth/sign-in`.
- This ensures users land on signup step 3 (DOB/personal information) as expected.

### Run: Validation

- `npm run check` ✅ (0 errors; existing non-blocking toggle-group warnings unchanged)

## 2026-03-15

### Signup Personal Step: Removed Name Field from DOB Step

- Updated `src/routes/auth/sign-up/+page.svelte` to remove the `Full name` input from step 3 (DOB/personal step).
- Step 3 continue validation now depends only on month + year selection.
- Signup request now uses `username` as the initial `name` field for `authClient.signUp.email`.
- Removed remaining step-4 submit guard dependency on `fullName`.

### Run: Validation

- `npm run check` ✅ (0 errors; existing non-blocking toggle-group warnings unchanged)

## 2026-03-15

### Signup Step 4 UI Order: Terms Checkbox + Google CTA

- Updated `src/routes/auth/sign-up/+page.svelte` account-details step order to:
  1. Header
  2. Terms checkbox line
  3. Outlined `Continue with Google` button (only when age > 16)
  4. Remaining account fields and sign-up button
- Kept existing conditional logic and account creation behavior unchanged.

### Run: Validation

- `npm run check` ✅ (0 errors; existing non-blocking toggle-group warnings unchanged)

## 2026-03-15

### Signup/Legal Navigation: Preserve Account Step After Opening Terms

- Fixed signup terms-navigation regression where returning from Terms could reset `/auth/sign-up` to DOB (step 3).
- Updated `src/routes/auth/sign-up/+page.svelte` to:
  - initialize signup step from the `step` query param,
  - sync step transitions into the URL with `history.replaceState` (so browser back preserves step),
  - generate a step-aware `backTo` URL for Terms (`/terms?backTo=...`).
- Updated `src/lib/components/app/legal/legal-document-screen.svelte` back action to:
  - prefer `backTo` query navigation via `goto`,
  - fall back to `history.back()` when `backTo` is absent.

### Run: Validation

- `npm run check` ✅ (0 errors; existing non-blocking toggle-group warnings unchanged)

## 2026-03-15

### Signup UI: Multicolor Google Logo in Social CTA

- Updated `src/routes/auth/sign-up/+page.svelte` to use the multicolor Google “G” icon in the `Continue with Google` button (`logos:google-icon` via Iconify).
- Added dependency `@iconify/svelte` for brand-accurate icon rendering.

### Run: Validation

- `npm run check` ✅ (0 errors; existing non-blocking toggle-group warnings unchanged)

## 2026-03-15

### Auth: Google OAuth Provider Registration + Signup UI Guard

- Fixed Google social signup failure (`/api/auth/sign-in/social` provider not found) by registering Google in Better Auth server config when credentials are present.
- Updated `src/convex/auth.ts` to include `socialProviders.google` using `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
- Added `src/routes/auth/sign-up/+page.server.ts` to expose `googleOAuthEnabled` from server env.
- Updated `src/routes/auth/sign-up/+page.svelte` to:
  - render `Continue with Google` only when age > 16 and Google OAuth is configured,
  - show a clear fallback error if Google OAuth is not configured.
- Documented required Google OAuth env variables in `.env.example` and `README.md`.

### Run: Validation

- `npm run check` ✅ (0 errors; existing non-blocking toggle-group warnings unchanged)

## 2026-03-15

### Signup Data Binding: Persist DOB + Signup Source + Onboarding Club Intent

- Added `profiles.signUpWith` schema field (`'email' | 'google'`) in `src/convex/schema.ts`.
- Added new mutation `api.auth.completeSignupProfile` in `src/convex/auth.ts` to persist signup metadata after authentication:
  - `signUpWith`
  - `dateOfBirth` (from month/year as `YYYY-MM`)
  - username normalization
  - inferred pending onboarding intent from `nextPath` (`pendingClubCode` + `pendingRole` for join/start club flows)
- Hardened `api.auth.ensureProfile` to keep profile fields in sync with auth-provider data (first/last name and image fallback).
- Updated `src/routes/auth/sign-up/+page.svelte` to call profile completion for:
  - email signup (after instant-token path and after OTP verification)
  - Google signup callback return path (`postSocial=google`)
- Updated Google social auth callback to return to signup route first, so profile completion runs before redirecting to onboarding target.
- Regenerated Convex bindings via `npm run convex:codegen`.

### Run: Validation

- `npm run check` ✅ (0 errors; existing non-blocking toggle-group warnings unchanged)

## 2026-03-15

### Signup UI: Show Google CTA for Age >16 Regardless of Env Gate

- Updated `src/routes/auth/sign-up/+page.svelte` to render the `Continue with Google` button whenever age is above 16 (removed `googleOAuthEnabled` visibility gate).
- Kept runtime guard in click handler so users still get a clear error if Google OAuth credentials are not configured.

### Run: Validation

- `npm run check` ✅ (0 errors; existing non-blocking toggle-group warnings unchanged)

## 2026-03-15

### i18n Update: Replace Hindi Locale with Dutch

- Updated i18n locale registry in `src/lib/i18n/index.ts`:
  - removed `hi`
  - added `nl`
- Added Dutch message bundle at `src/lib/i18n/messages/nl.ts`.
- Removed Hindi message bundle `src/lib/i18n/messages/hi.ts`.
- Updated settings language toggle in `src/routes/(app)/settings/+page.svelte` to show `English` and `Dutch` (`nl`).
- Updated English dictionary language labels in `src/lib/i18n/messages/en.ts` (`hindi` -> `dutch`).

### Run: Validation

- `npm run check` ✅ (0 errors; existing non-blocking toggle-group warnings unchanged)

## 2026-03-16

### Signup Google CTA: Removed Frontend False-Negative Config Gate

- Removed `googleOAuthEnabled` server-load gate from `/auth/sign-up`.
- Deleted `src/routes/auth/sign-up/+page.server.ts` and removed `isGoogleOAuthEnabled` checks in `src/routes/auth/sign-up/+page.svelte`.
- `Continue with Google` now always attempts social sign-up for age >16 (backend/provider config is now the only source of truth).

### Run: Validation

- `npm run check` ✅ (0 errors; existing non-blocking toggle-group warnings unchanged)

## 2026-03-16

### Auth Runtime Fix: Accept Both Google Env Naming Conventions

- Fixed Google provider registration in `src/convex/auth.ts` by adding env fallback support:
  - client id: `GOOGLE_CLIENT_ID` or `AUTH_GOOGLE_ID`
  - client secret: `GOOGLE_CLIENT_SECRET` or `AUTH_GOOGLE_SECRET`
- Root cause observed in active deployment: only `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` were set, which previously resulted in Better Auth `Provider not found` for `google`.

### Run: Validation

- `npm run check` ✅ (0 errors; existing non-blocking toggle-group warnings unchanged)

## 2026-03-16

### Auth UX: Email OTP Verification Screens + Global Snackbar + Success Screen

- Updated `src/routes/auth/sign-up/+page.svelte` to align email verification UI with Figma using existing components (`Button`, `InputOtp`, `Alert`):
  - heading/subcopy updated
  - email row with `Change` action
  - resend text-link behavior with countdown (`Resend (Ns)`)
  - verify button loading state (`Verifying` + spinner)
- Added reusable global snackbar component for future screens:
  - `src/lib/components/app/snackbar/snackbar-toast.svelte`
  - `src/lib/components/app/snackbar/index.ts` (`showGlobalSnackbar` helper)
- Wired resend success in sign-up verification step to global snackbar:
  - title: `Email resent`
  - description: `We've resent the email. Please check your inbox.`
- Added success screen using existing asset `src/lib/assets/images/success.png`.
- Updated auth flow behavior:
  - Email sign-up now proceeds to OTP verification step.
  - Google sign-up callback (`postSocial=google`) now shows success screen directly.
  - Both success paths auto-continue to `next` after a short delay.

### Run: Validation

- `npm run check` ✅ (0 errors; existing non-blocking toggle-group warnings unchanged)

## 2026-03-16

### Auth Session Sync Fix: Stop `ensureProfile` Unauthenticated Loop After OTP Verification

- Updated `src/routes/(app)/+layout.svelte` to gate app-level profile initialization behind a verified Convex user session (`api.auth.getCurrentUser`) before calling `api.auth.ensureProfile`.
- Gated app context queries (`getMyClubs`, `getActiveClubContext`) and bootstrap seeding on Convex-ready auth instead of only Better Auth local state.
- Updated `src/routes/auth/sign-up/+page.svelte` OTP finalize readiness check to verify both:
  - Better Auth session cookie hydration (`authClient.getSession`)
  - Convex user session availability (`api.auth.getCurrentUser`)
- Reduced post-OTP finalize retry latency (`500ms`) and capped retries (`20`) to avoid long “finalizing” stalls.

### Run: Validation

- `npm run check` ✅ (0 errors; existing non-blocking toggle-group warnings unchanged)

## 2026-03-16

### Signup Success Screen: Manual Next CTA After Email Verification

- Updated `src/routes/auth/sign-up/+page.svelte` success state behavior:
  - removed auto-redirect timer after verification success
  - added explicit `Next` button on the success screen
  - wired `Next` to navigate to `nextPath` with `replaceState: true`
  - added button loading/disable guard to prevent double navigation

### Run: Validation

- `npm run check` ✅ (0 errors; existing non-blocking toggle-group warnings unchanged)

## 2026-03-16

### OTP Finalization Reliability: Explicit Sign-In After Email Verification

- Updated `src/routes/auth/sign-up/+page.svelte` OTP flow to explicitly sign in after `emailOtp.verifyEmail` succeeds:
  - added `ensureSessionAfterEmailVerification()` helper
  - performs `authClient.signIn.email({ email, password })` before finalizing profile
  - falls back to `getSession({ disableCookieCache: true })` if sign-in returns an error but session is already present
- Updated verify state messaging:
  - `Email verified. Signing you in...` before finalization
  - then `Email verified. Finalizing your account...`
- Goal: remove dependence on delayed background session hydration and prevent recurring `Session sync is taking too long` failures.

### Run: Validation

- `npm run check` ✅ (0 errors; existing non-blocking toggle-group warnings unchanged)

## 2026-03-16

### OTP Finalization Reliability (Follow-up): Retry Immediate Sign-In After Verify

- Hardened `src/routes/auth/sign-up/+page.svelte` `ensureSessionAfterEmailVerification()`:
  - added retry loop for post-verify `signIn.email` (`6` attempts, `400ms` delay)
  - retries only on transient verification/auth sync style errors
  - still falls back to `getSession({ disableCookieCache: true })` before failing
- Purpose: handle short consistency windows right after OTP verification where sign-in can momentarily report not verified/unauthenticated.

### Run: Validation

- `npm run check` ✅ (0 errors; existing non-blocking toggle-group warnings unchanged)

## 2026-03-16

### Onboarding Layout Consistency: Show Left Illustration in Signup Steps on Web

- Updated `src/routes/auth/sign-up/+page.svelte` to pass `showSideIllustration={true}` to `FlowShell`.
- Result: desktop/web now shows the left onboarding illustration for all signup steps (personal info, account details, and OTP verification), matching join/start onboarding layouts.

## 2026-03-16

### Signup Verify Callback Fix: Keep User on Step 5 Until Success `Next`

- Updated `src/routes/auth/sign-up/+page.svelte` to use a dedicated `verificationCallbackPath` (`/auth/sign-up?step=5...`) instead of `nextPath` during:
  - `authClient.signUp.email(...)`
  - post-verify `authClient.signIn.email(...)`
- Prevents unexpected redirect to onboarding/get-started/club-detail before success screen is shown.
- Success flow now reliably stays on signup, shows success UI, and moves forward only when user taps `Next`.

### Run: Validation

- `npm run check` ✅ (0 errors; existing non-blocking toggle-group warnings unchanged)

## 2026-03-16

### Signup OTP Recovery Fix: Persist Draft + Auto-Resume Finalization on Step 5

- Updated `src/routes/auth/sign-up/+page.svelte`:
  - Added `sessionStorage` signup draft persistence (`cl_signup_draft_v1`) for email, DOB, terms, and current step.
  - Added initial draft hydration to restore state after callback/reload.
  - Added step-5 authenticated auto-resume logic:
    - fills email from session when missing
    - sets `awaitingEmailPostVerify` automatically
    - queues finalization without requiring another OTP entry
  - Clears persisted draft when success screen is shown.
- Purpose: prevent the “empty verify email screen” after verification redirect/splash reload and continue reliably to success.

### Backend Noise Guard: `ensureProfile` No-Throw on Unauthenticated

- Updated `src/convex/auth.ts` `ensureProfile` to use `safeGetAuthUser` and return `null` when unauthenticated, instead of throwing.
- Purpose: remove repeated unauthenticated error spam from backend logs if a stale/early client call occurs.

### Run: Validation

- `npm run check` ✅ (0 errors; existing non-blocking toggle-group warnings unchanged)

## 2026-03-16

### Post-Signup Onboarding: Added 2 New Steps After Success

- Updated `src/routes/auth/sign-up/+page.svelte`:
  - `Hooray -> Next` now routes to `/auth/post-signup?next=/`.
- Added new route `src/routes/auth/post-signup/+page.svelte` with shared onboarding shell and styling:
  - Step 1: required `Username` + optional profile image upload.
    - Uses existing `InputField`, `Button`, and Convex upload flow (`api.media.generateUploadUrl`).
    - Persists data via `api.profiles.updateMe` (`username`, `profileImageStorageId`).
  - Step 2: collapsible agreements list + mandatory checkbox.
    - Requires user confirmation before continue.
    - On continue, sets `firstLoginCompleted: true` via `api.profiles.updateMe`, then routes to dashboard path (`/`).
- Added auth guard in post-signup route:
  - unauthenticated users are redirected to sign-in with a return URL back to post-signup.
- Added completion guard:
  - if `firstLoginCompleted` is already true, route immediately to next path.

### Run: Validation

- `npm run check` ✅ (0 errors; existing non-blocking toggle-group warnings unchanged)

## 2026-03-16

### Signup Loop Fix: Prevent Verify/Success Bounce Before Post-Signup

- Updated `src/routes/auth/sign-up/+page.svelte`:
  - removed explicit `signIn.email` call after OTP verification to avoid callback-driven route bounces.
  - added `cl_post_signup_pending_v1` session flag.
  - when pending flag exists and session is present, sign-up route now force-redirects to `/auth/post-signup`.
  - `Hooray -> Next` sets this pending flag before navigation.
- Updated `src/routes/auth/post-signup/+page.svelte`:
  - clears the pending flag when onboarding is completed or already complete.

### Run: Validation

- `npm run check` ✅ (0 errors; existing non-blocking toggle-group warnings unchanged)

## 2026-03-16

### Post-Signup Layout Alignment: Same Onboarding Shell Without Progress Bar

- Updated shared `FlowShell` (`src/lib/components/app/onboarding/flow-shell.svelte`) with `showProgressBar` prop (default `true`).
- Updated post-signup flow (`src/routes/auth/post-signup/+page.svelte`) to use:
  - `showSideIllustration={true}`
  - `showProgressBar={false}`
  - `showAccountLink={false}`
- Result: post-signup keeps the same white layout with left illustration + right content as onboarding, but no top progress strip.

### Run: Validation

- `npm run check` ✅ (0 errors; existing non-blocking toggle-group warnings unchanged)

## 2026-03-16

### Signup Bounce Guard: Immediate Redirect to Post-Signup When Pending

- Updated `src/routes/auth/sign-up/+page.svelte` with an early redirect effect:
  - if `cl_post_signup_pending_v1` is set, route immediately to `/auth/post-signup`
  - prevents temporary render of OTP/success states during callback hydration bounces
- Added local `postSignupRedirecting` guard to avoid duplicate navigations.

### Run: Validation

- `npm run check` ✅ (0 errors; existing non-blocking toggle-group warnings unchanged)

## 2026-03-16

### Post-Signup Route Move: Use Onboarding Layout Instead of Auth Card Layout

- Moved main post-signup flow UI route from `/auth/post-signup` to `/onboarding/post-signup`:
  - `src/routes/onboarding/post-signup/+page.svelte`
- Updated sign-up success navigation and pending-flow redirects to target `/onboarding/post-signup`.
- Added compatibility redirect route:
  - `src/routes/auth/post-signup/+page.svelte` now forwards to `/onboarding/post-signup` while preserving query params.
- Purpose: ensure post-signup screens render with onboarding shell style (left image + right content) and not inside auth card UI.

### Run: Validation

- `npm run check` ✅ (0 errors; existing non-blocking toggle-group warnings unchanged)

## 2026-03-16

### Hard Redirect Guard: Eliminate Auth Card Wrapper for Legacy `/auth/post-signup`

- Updated `src/routes/auth/+layout.svelte` to treat `/auth/post-signup` as onboarding-style route (white full-screen wrapper) instead of auth card layout.
- Replaced client-side compatibility page with server redirect:
  - added `src/routes/auth/post-signup/+page.ts` redirecting to `/onboarding/post-signup`
  - removed `src/routes/auth/post-signup/+page.svelte`
- Purpose: prevent old auth card header/subheader UI from appearing in post-signup flow and avoid client-side flicker.

### Run: Validation

- `npm run check` ✅ (0 errors; existing non-blocking toggle-group warnings unchanged)

## 2026-03-16

### Post-Signup Navigation Constraint: Removed In-Screen Back Button

- Updated `src/routes/onboarding/post-signup/+page.svelte`:
  - removed back button UI entirely
  - removed back-navigation handler for the post-signup steps
- Result: after success screen, post-signup flow is forward-only in UI and does not expose navigation back to prior signup/OTP screens.

### Run: Validation

- `npm run check` ✅ (0 errors; existing non-blocking toggle-group warnings unchanged)

## 2026-03-16

### Review & Accept Now Uses Convex Pledge API (PDF-Backed Seed Data)

- Added a new `pledges` data model and API to source Review & Accept content from DB instead of hardcoded UI content.
  - Table: `src/convex/schema.ts` (`pledges` with key/title/description/bullets/order/isActive/timestamps)
  - API: `src/convex/pledges.ts`
    - `listActive` query for ordered active pledges
    - `seedDefaults` mutation to upsert guiding-principle pledges extracted from the provided PDF
- Updated post-signup review screen:
  - `src/routes/onboarding/post-signup/+page.svelte`
  - replaced static `agreementItems` with `api.pledges.listActive` data
  - renders pledge title + description + bullet points in collapsible sections
  - auto-seeds default pledges once when table is empty for authenticated users

### Run: Validation

- `npm run check` ✅ (0 errors; existing non-blocking toggle-group warnings unchanged)

## 2026-03-16

### Login Eye Alignment + Onboarding Step Continuity (Join/Start Club)

- Updated shared input trailing-slot alignment to vertically center right-side icons/buttons in password fields:
  - `src/lib/components/app/form/input-field.svelte`
- Fixed onboarding sign-up back navigation path mapping so Join Club signup returns to the club-detail step instead of Get Started:
  - `src/routes/auth/sign-up/+page.svelte`
  - back path now respects:
    - `/onboarding/start-club?step=2`
    - `/onboarding/join-club/:code`
    - `/onboarding/join-club`
- Updated Start Club flow shell progress to 5-step continuity so it aligns with the downstream personal-details/account/OTP signup phases:
  - `src/routes/onboarding/start-club/+page.svelte` (`total={5}`)

### Run: Validation

- `npm run check` ✅ (0 errors; existing non-blocking toggle-group warnings unchanged)

## 2026-03-16

### Reset Password Flow Spacing Pass (All States)

- Updated reset-password screen spacing for consistent vertical rhythm across all states:
  - request reset form
  - reset link sent
  - create new password
- Increased content stack spacing and button-group separation:
  - content `gap` adjusted from `5` to `6`
  - footer action groups updated to include `pt-4` and `gap-4`
- Purpose: add clearer space after `Username/Email` input and after primary reset action, matching onboarding spacing quality.

### Run: Validation

- `npm run check` ✅ (0 errors; existing non-blocking toggle-group warnings unchanged)

## 2026-03-16

### Splash Behavior After Login: Skip Launcher For Authenticated Sessions

- Updated root layout launcher logic so authenticated users do not see the splash before dashboard redirects.
  - File: `src/routes/+layout.svelte`
  - Launcher now derives visibility from:
    - server auth state (`authState.isAuthenticated`)
    - local launcher timer completion for signed-out users
- Result:
  - Signed-in flows (including post-login) bypass splash.
  - Signed-out app-open still shows launcher for the configured duration.

### Run: Validation

- `npm run check` ✅ (0 errors; existing non-blocking toggle-group warnings unchanged)

## 2026-03-16

### Mobile Step Layout: Top Progress + Bottom-Pinned Actions Across Onboarding/Auth Steps

- Updated shared onboarding shell to enforce mobile step structure consistently:
  - progress/header area remains at top
  - content takes full mobile viewport height
  - action sections using `mt-auto` stay at the bottom
- File updated:
  - `src/lib/components/app/onboarding/flow-shell.svelte`
- Implementation details:
  - mobile-first container now stretches full height (`min-h-[calc(100dvh-2rem)]`)
  - removed mobile vertical centering behavior from shell wrapper
  - retained desktop centering behavior (`lg:items-center`) and side illustration layout

### Run: Validation

- `npm run check` ✅ (0 errors; existing non-blocking toggle-group warnings unchanged)

## 2026-03-16

### OTP Verification Finalization Reliability Fix (Email Sign Up)

- Reworked email-OTP post-verification finalize flow to avoid long polling deadlock and session-timeout errors.
  - File: `src/routes/auth/sign-up/+page.svelte`
- Key changes:
  - after OTP verify success, run deterministic finalization immediately (no deferred timer loop)
  - explicitly ensure authenticated session after OTP via:
    - `authClient.getSession(disableCookieCache)`
    - fallback `authClient.signIn.email(...)` with entered credentials
  - handle `already verified` OTP response by continuing finalize flow instead of failing verification
  - complete profile mutation with capped retries only for transient `Unauthenticated` sync lag
  - if session still unavailable, route user to sign-in with pending post-signup continuation preserved
  - removed auto-finalize trigger that ran on step-5 page load and could cause inconsistent loops
- Result:
  - faster post-OTP transition
  - avoids repeated “Session sync is taking too long” in common verify flow

### Run: Validation

- `npm run check` ✅ (0 errors; existing non-blocking toggle-group warnings unchanged)

## 2026-03-22

### Onboarding: Dropdowns Flip Above Inputs When Space Is Tight

- Updated the shared `DropdownField` used on `/onboarding/start-club` so its menu measures viewport space while open.
- Dropdowns now open above the input when there is not enough room below, instead of clipping off-screen near the bottom of the viewport.
- Added viewport-aware max-height recalculation during open state so long option lists stay usable on smaller screens and during resize/scroll changes.
- This fixes the referral-source dropdown for `How did you find out about us?` when it appears close to the bottom of the form.

### Run: Validation

- `npm run check` ✅ (0 errors; existing non-blocking toggle-group warnings unchanged)

## 2026-03-22

### Onboarding: Get Started Language Picker

- Added a globe icon button at the top-right of `/onboarding/get-started`.
- The dropdown allowed users to switch between English and Dutch before entering auth or onboarding flows.
- The current language was marked inside the menu, and selection persisted across reloads.

## 2026-03-22

### Auth: Sign-In Verification Action Spacing

- Fixed the spacing between `Resend verification email` and `Log in` on `/auth/sign-in`.
- Moved the resend action into the same bottom button stack so shared vertical gaps are applied consistently whenever the verification CTA is shown.

## 2026-03-22

### Auth: Invalid Email Sign-In Error Uses Snackbar

- Updated `/auth/sign-in` so `Invalid email` failures now surface through the global snackbar instead of the inline destructive alert.
- Other sign-in errors still use the existing on-screen alert behavior.

## 2026-03-22

### Auth: Wrong Password No Longer Triggers Invalid Email Snackbar

- Tightened the `/auth/sign-in` invalid-email detection so only exact invalid-email messages use the snackbar.
- Combined credential failures such as wrong-password responses now fall back to the normal inline sign-in error state.

## 2026-03-22

### Onboarding: Join Club Code Inputs Now Fit Mobile Width

- Updated `/onboarding/join-club` so the 6-character club code inputs use a responsive 6-column grid instead of a fixed horizontal row.
- The code boxes now shrink on smaller screens rather than causing sideways scrolling while entering the club code.

## 2026-03-22

### Onboarding: Join Club Actions No Longer Force Horizontal Overflow On Mobile

- Updated `/onboarding/join-club` to prevent action elements from pushing the page sideways on small screens.
- The `View public clubs near you` prompt now wraps naturally, and the main CTA buttons override nowrap sizing locally so they stay responsive instead of contributing to horizontal scroll.

## 2026-03-22

### Onboarding: Join Club QR Scan CTA Removed For Now

- Removed the `Scan a QR code` action from `/onboarding/join-club`.
- Also deleted the now-unused mobile camera capability detection and QR icon import tied to that temporary CTA.

## 2026-03-22

### Auth: Join Club Google Signup No Longer Loops Back To Club Preview

- Updated the signup success handoff so join-club invite flows stop carrying the club preview route as the final post-signup `next` destination.
- The pending club code is still preserved during account creation, but `/onboarding/post-signup` now falls back to `/` after completion instead of reopening `/onboarding/join-club/[code]`.
- `npm run check` ✅ (`0` errors, same existing `toggle-group.svelte` warnings)

## 2026-03-22

### Auth: Signup Header Actions Moved Below Progress Bar On Desktop

- Updated the shared onboarding `FlowShell` to support an optional secondary header row directly below the progress bar.
- In `/auth/sign-up`, the back button now sits on the left and `I have an account` sits on the right in that row on desktop, instead of rendering the account link in the top-right header lane.
- The sign-in link also preserves the current signup `next` destination when present.
- `npm run check` ✅ (`0` errors, same existing `toggle-group.svelte` warnings)

## 2026-03-22

### Onboarding: Existing Session Is Reused For Club Invite Joins

- Updated `/onboarding/join-club/[code]` so signed-in users are no longer signed out when they tap `Join as a learner`.
- The invite now attempts to join the club with the current account immediately, which keeps the session intact and navigates straight into the club on success.
- If the current account is already a member of that club, the flow now routes directly to that club instead of failing on an avoidable auth interruption.
- `npm run check` ✅ (`0` errors, same existing `toggle-group.svelte` warnings)

## 2026-03-22

### Auth: Google Signup Shows Loading State And Avoids Callback Screen Flash

- Updated `/auth/sign-up` so `Continue with Google` now shows an inline spinner and loading label while the Google redirect is being started.
- Added a dedicated post-Google processing screen so the previous signup step no longer briefly flashes before the success screen appears on callback return.
- Cleared the `postSocial` URL flag after handling the callback so the success/error transition stays stable.
- `npm run check` ✅ (`0` errors, same existing `toggle-group.svelte` warnings)

## 2026-03-22

### Onboarding: Post-Signup Flow No Longer Auto-Skips Required Username And Pledges

- Updated `/onboarding/post-signup` so an active signup handoff keeps users inside the required onboarding flow even if their profile already has `firstLoginCompleted: true`.
- This prevents the username screen from auto-redirecting to home before the user finishes the mandatory username step and accepts the pledges.
- `npm run check` ✅ (`0` errors, same existing `toggle-group.svelte` warnings)

## 2026-03-22

### Auth: Login Screen Now Supports Google Sign-In

- Added a `Continue with Google` button to `/auth/sign-in` using the same outline styling as the Google button on signup.
- The login flow now calls Better Auth social sign-in for Google with the current `next` destination, so users who registered with Google can return with Google from the login screen.
- Added an inline spinner/loading label while the Google redirect is starting.
- `npm run check` ✅ (`0` errors, same existing `toggle-group.svelte` warnings)

## 2026-03-22

### Auth: Existing Google Accounts No Longer Fall Through Signup As New Users

- Updated Google signup on `/auth/sign-up` to use Better Auth's separate existing-user and new-user callback paths.
- If the Google account already exists, the flow now lands on `/auth/sign-in` and treats it like login instead of showing the signup success/onboarding path again.
- Added existing-account messaging on `/auth/sign-in` so the user is told that the Google account already exists and is signed in appropriately.
- `npm run check` ✅ (`0` errors, same existing `toggle-group.svelte` warnings)

## 2026-03-22

### Auth: Fresh Start/Join Club Signup Intents No Longer Get Rerouted To Login

- Updated `/auth/sign-up` so a stale post-signup session flag is cleared when there is no authenticated session, instead of redirecting a fresh signup attempt into post-signup/login.
- This fixes onboarding entry paths like `/onboarding/start-club?step=2` and `/onboarding/join-club/[code]`, which should open the signup steps for a new user instead of unexpectedly landing on the login screen.
- `npm run check` ✅ (`0` errors, same existing `toggle-group.svelte` warnings)

## 2026-03-22

### Auth: Signup Flow No Longer Auto-Jumps Into Login During Recovery States

- Updated `/auth/sign-up` so existing Google-account handling stays inside the signup flow and continues with the already signed-in account instead of redirecting to `/auth/sign-in` mid-flow.
- Removed the email-verification fallback that previously kicked the user to login when session sync lagged; the signup flow now stays on the verification step and asks the user to retry there instead.
- Updated `/onboarding/post-signup` to hold on a signup-session recovery screen while an active signup handoff is being restored, instead of auto-redirecting to login before the mandatory username and pledge steps finish.
- `npm run check` ✅ (`0` errors, same existing `toggle-group.svelte` warnings)

## 2026-03-22

### Auth: No-Club Login No Longer Loops Back To Get Started

- Updated the root route so authenticated users with no clubs are sent to `/profile` instead of being bounced back to `/onboarding/get-started`.
- Updated the get-started `I have an account` action to sign in with `next=/profile`, which avoids the `/` → get-started redirect loop for signed-in accounts that have not joined or created a club yet.
- `npm run check` ✅ (`0` errors, same existing `toggle-group.svelte` warnings)

## 2026-03-22

### Onboarding: Start-Club Signup Now Resumes Instead Of Feeling Like It Jumps Back

- Updated `/onboarding/start-club` to send unauthenticated users into `/auth/sign-up` with `forceSignup=1`, matching the protected join-club flow and preventing premature redirects back to earlier onboarding steps.
- Added session-storage draft persistence for the start-club fields so location, role, about, and referral answers survive the account-creation handoff and resume when the user returns.
- Cleared the saved draft after club creation succeeds.
- `npm run check` ✅ (`0` errors, same existing `toggle-group.svelte` warnings)

## 2026-03-22

### Onboarding: Club Join Dashboard Loading Is More Session-Stable

- Updated the club route access guard to wait for auth readiness before deciding membership access, instead of immediately querying club membership during auth/session hydration.
- Successful club joins now also remember the joined club in local storage before navigation, which helps the app shell stabilize faster on the destination club dashboard.
- This was applied to both the direct join-club path and the post-signup pending-club completion path.
- `npm run check` ✅ (`0` errors, same existing `toggle-group.svelte` warnings)

## 2026-03-23

### Branch Cleanup: Remove CL-689 i18n Wiring

- Removed the branch-local i18n subsystem and reverted the app to fixed English copy on this branch.
- Deleted `src/lib/i18n/*`, removed `svelte-i18n` from the package manifests, and removed the onboarding/settings language switchers.
- Replaced localized strings in the root layout, launcher, cookie banner, and get-started screen with plain English while keeping auth, launcher, and cookie-consent behavior unchanged.

### Auth Routing: Server-First Redirects And Main-Parity Club Navigation

- Added a server guard for `/auth/*` so authenticated users no longer land on sign-in, sign-up, or reset-password screens in new tabs; they are redirected back into the app immediately.
- Updated `/onboarding/get-started` to redirect authenticated users to `/`, keeping onboarding entry points bounded to signed-out users.
- Switched sign-in, sign-up, and post-signup route guards to use the shared auth readiness state instead of cached client session data during hydration.
- Restored the app-shell club navigation query timing and club layout access handling to match `main`, so the club drawer navigation follows the stable branch behavior.
- `npm run check` ✅ (`0` errors, same existing `toggle-group.svelte` warnings)

### Session Hardening: Fresh Onboarding Starts And Cleaner Logout Boundaries

- Added a shared client-side onboarding state reset helper to clear signup drafts, post-signup handoff flags, and remembered club context when a user signs out.
- Updated the get-started screen to clear stale onboarding handoff state on mount, so a new onboarding attempt starts cleanly instead of inheriting a previous user's partially completed flow.
- Replaced the last onboarding `useSession()` gates in join-club and start-club with shared auth readiness checks, so those steps no longer branch on cached client session data mid-flow.
- Strengthened sign-out by waiting for a fresh `getSession({ disableCookieCache: true })` check before routing to login, reducing same-browser account handoff issues when a new user signs up after logout.
- `npm run check` ✅ (`0` errors, same existing `toggle-group.svelte` warnings)

### OTP Verification: Longer Finalization Window For Slow Session Sync

- Extended the email-OTP post-verification finalize flow so it no longer gives up after a short session sync window.
- The signup screen now uses the OTP verification response itself to detect auto-sign-in, waits through a staged retry window, and only attempts fallback email sign-in later if the verified session still has not propagated.
- Finalization failures now keep the user in the verification context with a retry message instead of immediately forcing a sign-in-again outcome when sync is simply slow.
- `npm run check` ✅ (`0` errors, same existing `toggle-group.svelte` warnings)

- 2026-03-23: Added signup preflight account checks for existing email/password and Google accounts. Existing verified-but-incomplete users now resume post-signup after sign-in; existing complete users are redirected to sign-in; unverified existing users are sent to OTP without creating duplicate accounts.

## 2026-02-26

### UI Standardization: Lucide Icon Stroke Weight Tokens

- Audited icon usage across the app and confirmed Lucide is the icon system in active use:
  - 66 Lucide icon imports across 36 source files.
  - Only one feature-level stroke-weight override existed (`strokeWidth={2.75}` in `club-session-card.svelte`).
- Added global icon stroke tokens and policy wiring in `src/routes/layout.css`:
  - `--icon-stroke-default`
  - `--icon-stroke-subtle`
  - `--icon-stroke-strong`
- Added global Lucide rule so icon stroke is token-driven (`.lucide-icon`) with semantic exception classes:
  - `icon-stroke-subtle`
  - `icon-stroke-strong`
- Replaced the hard-coded session-card calendar override with `icon-stroke-strong` in `src/lib/components/app/sessions/club-session-card.svelte`.
- Added ADR-010 (`docs/adr/010-icon-stroke-weight-policy.md`) and updated `docs/architecture.md` with the policy.

### Run: Validation

- `npm run check` ✅ (0 errors, existing 3 warnings unchanged in `src/lib/components/ui/toggle-group/toggle-group.svelte`)

### 2026-03-22: Media Upload Dev Test Surface

- Added a temporary authenticated route at `src/routes/(app)/settings/media-upload-dev/+page.svelte` to exercise the shared `mediaAssets` pipeline without using the Convex dashboard.
- The page lets us configure per-upload constraints, pick a single file through the local `FileDropZone` UI component, run the real begin/upload/finalize flow, and inspect retry/restart/cancel behavior on existing uploads.
- Added a settings entry point so the test surface is discoverable from the app.
- Expanded the same test surface to support multi-file selection, submitting each selected file as its own upload session so batch behavior can be exercised without changing the one-file-per-asset backend contract.
- Removed temporary `contextType` / `contextId` metadata from `mediaAssets` and the dev page so the upload foundation stays focused on storage, validation, and processing rather than soft ownership hints.
- Added built-in `FileDropZone` rejection toasts (enabled by default, opt-out via `showErrorToasts={false}`) so feature code can get sane error UX without custom wiring, while still allowing temporary tools or future feature pages to render inline rejection details instead.
- Removed the temporary dev test route after validation so the branch lands with the shared pipeline and reusable drop-zone behavior, but without shipping an internal-only settings surface.

## 2026-03-14

### DevOps: Baseline PR Gate

- Added GitHub Actions workflow `.github/workflows/pr-gate.yml`.
- The gate runs on every `pull_request` and on direct pushes to `main` and `development`.
- It intentionally stays small and fast:
  - `npm ci`
  - `npm run check`
  - `npm run lint:ci`
  - `npm run build`
- Added `lint:ci` and `ci` package scripts so the PR gate can stay focused on breakage detection without turning every change into a full prettier-plus-test run.

### Run: Validation

- `npm run ci` ✅
- `npm run check` reports 0 errors and the same existing 3 Svelte warnings in `src/lib/components/ui/toggle-group/toggle-group.svelte`.

### Infra: Render Node Runtime

- Replaced `@sveltejs/adapter-auto` with `@sveltejs/adapter-node` so production deploys target a long-lived Node server explicitly.
- Updated `svelte.config.js` to use the Node adapter.
- Documented the Render production contract:
  - build command `npm install && npm run build`
  - start command `node build/index.js`
  - required Render and Convex production environment variables
- Added ADR-011 covering the Node runtime decision and environment ownership split.

### Run: Validation

- `npm run check` ✅
- `npm run build` ✅

### Follow-up: Promote Strong Stroke to Global Default

- Updated icon stroke tokens in `src/routes/layout.css` so old "strong" visual weight is now the baseline:
  - `--icon-stroke-default: 2.75` (was `2`)
  - `--icon-stroke-subtle: 2.25` (was `1.75`)
  - `--icon-stroke-strong: 3` (was `2.75`)
- Removed the remaining `icon-stroke-strong` class usages in `src/lib/components/app/sessions/club-session-card.svelte` so those icons now inherit the new global default.
- Result: all current icon instances render at default weight unless a future feature explicitly opts into `icon-stroke-subtle`/`icon-stroke-strong`.

### Run: Validation

- `npm run check` ✅ (0 errors, existing 3 warnings unchanged in `src/lib/components/ui/toggle-group/toggle-group.svelte`)

### Bug Fix: Club Dashboard Create-Session “Open” Could Stay on Dashboard

- Hardened create-session navigation on both club dashboard and sessions list routes:
  - `src/routes/(app)/club/[clubId]/+page.svelte`
  - `src/routes/(app)/club/[clubId]/sessions/+page.svelte`
- `createSession` now snapshots `startTime`/`endTime` before async mutation work, so navigation state is built from stable values.
- Header hint formatting is now guarded (`Number.isFinite`) before `formatSessionHeaderLine(...)`, preventing a formatting/runtime edge case from skipping navigation after successful create.

## 2026-03-22

### Foundation: Shared Media Upload Pipeline

- Added a shared Convex-native upload foundation in:
  - `src/convex/media.ts`
  - `src/convex/mediaPipeline.ts`
  - `src/convex/mediaModel.ts`
- Added `mediaAssets` to the schema as the canonical upload record for user-facing media.
- The pipeline now:
  - creates draft uploads and signed storage URLs,
  - finalizes uploads against `Id<"_storage">`,
  - reads authoritative file metadata from the `"_storage"` system table,
  - validates each file against per-upload constraints (`acceptedContentTypes`, `maxBytes`, processing flags),
  - tracks explicit states (`pending_upload`, `processing`, `ready`, `failed`, `canceled`),
  - and exposes restart/cancel/retry hooks for recoverability.
- Kept file URLs ephemeral by generating them at read time with `ctx.storage.getUrl(...)` instead of persisting them in tables.
- Refined the initial design away from a backend `purpose` enum and into a constraint-based contract so new upload surfaces can choose their own MIME/size rules without registering a new global upload type.
- Wired compression and safety screening as shared pipeline steps so future processors can extend the same contract rather than creating feature-specific upload implementations.

### Documentation

- Added ADR-012 for the shared media upload pipeline decision.
- Updated architecture, data model, parity matrix, and implementation plan docs to reflect the new media foundation.

### Run: Validation

- `npm run convex:codegen` ✅
- `npm run check` ✅ (0 errors, existing 3 warnings unchanged in `src/lib/components/ui/toggle-group/toggle-group.svelte`)
- Session open now retries with plain `goto(target)` if the stateful navigation attempt throws, ensuring the new session still opens.
- Dashboard flow now closes the create dialog after navigation attempt rather than before, reducing chances of state churn affecting post-create routing.

### Run: Validation

- `mcp__svelte__svelte-autofixer` ✅ (`src/routes/(app)/club/[clubId]/+page.svelte`, `src/routes/(app)/club/[clubId]/sessions/+page.svelte`)
- `npm run check` ✅ (0 errors, existing 3 warnings unchanged in `src/lib/components/ui/toggle-group/toggle-group.svelte`)

### Follow-up Hardening: Create-Session Errors Are Surfaced In-Form

- Updated `src/routes/(app)/club/[clubId]/+page.svelte` to remove silent create-session failures.
- Added dialog-scoped `createSessionError` state and a destructive alert inside the create-session dialog so failures are visible at the point of action.
- Create flow now:
  - clears dialog errors on open and before submit,
  - closes dialog only after successful navigation/open,
  - surfaces mutation/navigation failures with explicit messaging instead of swallowing them.

### Debug Instrumentation: End-to-End Create-Session Trace IDs

- Added optional `clientRequestId` to `api.sessions.create` in `src/convex/sessions.ts`.
- Added Convex-side structured logs for create lifecycle:
  - `sessions:create:start`
  - `sessions:create:inserted`
  - `sessions:create:return`
- Updated both create-session UI flows to generate and pass `clientRequestId`:
  - `src/routes/(app)/club/[clubId]/+page.svelte`
  - `src/routes/(app)/club/[clubId]/sessions/+page.svelte`
- User-facing create/open error messages now include `Ref: <clientRequestId>` for direct correlation with Convex logs.
- Added bounded timeouts for both mutation and navigation steps in create-session flows to prevent indefinite `Creating...` state when responses/navigation hang:
  - create mutation timeout: 12s
  - open navigation timeout: 5s (with stateful then plain-route fallback)
- This enables deterministic debugging for “session created but UI stuck” reports by mapping one button click to backend completion and frontend follow-up behavior.

### Follow-up Fix: Create Session Honors Connectivity Guard (No Queued Hang)

- Correlated a reported timeout ref (`83545e75-b1f0-4178-ae05-5355e5e88c35`) and confirmed no matching `sessions:create` execution reached Convex for that click.
- Updated both create-session flows to use the existing connectivity guard pattern (already used in session detail):
  - `src/routes/(app)/club/[clubId]/+page.svelte`
  - `src/routes/(app)/club/[clubId]/sessions/+page.svelte`
- Added `canMutateOnline` / `connectivityMessage` wiring and fast-fail behavior before mutation calls.
- Create/open buttons are now disabled when mutation connectivity is unhealthy, preventing queued indefinite mutation waits.
- Mutation success/failure now reports through `reportMutationSuccess` / `reportMutationFailure` to keep connectivity state accurate.

### Run: Validation

- `npm run check` ✅ (0 errors, existing 3 warnings unchanged in `src/lib/components/ui/toggle-group/toggle-group.svelte`)

### Review Adjustment: Keep Create Actions Testable While Still Bounded

- Removed create-button disabling tied to `canMutateOnline` from both create-session flows so offline/error-path behavior can still be exercised interactively.
- Removed early-return gating on `canMutateOnline` before attempting `sessions.create`; create now always attempts and uses timeout + explicit error handling.
- Kept bounded create/open timeouts and request-id references to avoid indefinite `Creating...` and preserve deterministic tracing.
- Reduced session create timeout from 12s to 6s for faster failure feedback in degraded connectivity scenarios.

### Simplification: Remove Debug-Only Overhead, Keep Core Reliability

- Removed debug-only request tracing from create-session flow:
  - dropped `clientRequestId` from `api.sessions.create` arguments in `src/convex/sessions.ts`
  - removed temporary Convex create lifecycle logs (`sessions:create:start|inserted|return`)
  - removed `Ref:` suffixes from user-facing errors
- Kept only the essential safeguards:
  - stable snapshot of form values before async create/navigation
  - in-form error UI on club dashboard create dialog
  - bounded create timeout (6s) to avoid indefinite `Creating...`
  - simple navigation fallback (`goto` with state, then plain `goto`)
- This returns the implementation to a minimal, maintainable baseline while preserving the fixes for the original bug and spinner hang.

### Run: Validation

- `npm run check` ✅ (0 errors, existing 3 warnings unchanged in `src/lib/components/ui/toggle-group/toggle-group.svelte`)

### Run: Validation

- `npm run convex:codegen` ✅
- `npm run check` ✅ (0 errors, existing 3 warnings unchanged in `src/lib/components/ui/toggle-group/toggle-group.svelte`)

### Follow-up: Session Planning Respects Global Offline Gating

- Aligned create-session entry points with the documented connectivity policy (`canMutateOnline`) for mutation-capable UI.
- Updated `src/routes/(app)/club/[clubId]/sessions/+page.svelte`:
  - disabled the header create (`+`) action while offline/unhealthy,
  - disabled dialog `Open` while offline/unhealthy,
  - added a create-path guard in `createSession` for `!canMutateOnline`.
- Updated `src/routes/(app)/club/[clubId]/+page.svelte` create flow to report mutation outcomes through:
  - `reportMutationSuccess(...)` on successful create mutation,
  - `reportMutationFailure(...)` on errors.
- Result: both dashboard and sessions-list create flows now follow the same centralized online-mutation behavior used elsewhere (for example session detail), without extra per-route offline logic.

### Run: Validation

- `npm run check` ✅ (0 errors, existing 3 warnings unchanged in `src/lib/components/ui/toggle-group/toggle-group.svelte`)

- 2026-03-24: Refactored auth/onboarding media uploads to reuse the shared FileDropZone and media begin/finalize flow in post-signup profile setup and start-club video upload. Kept profile and club domain mutations unchanged by continuing to persist profileImageStorageId and videoStorageId from the finalized media asset.
