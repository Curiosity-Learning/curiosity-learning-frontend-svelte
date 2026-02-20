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
