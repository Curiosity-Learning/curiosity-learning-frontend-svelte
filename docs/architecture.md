# Architecture

> Stack, routing, UI patterns, and conventions. For data model see [data-model.md](data-model.md). For security see [security.md](security.md).

## Stack

- SvelteKit (Svelte 5, TypeScript)
- Tailwind v4 + shadcn-svelte
- Convex backend
- Better Auth (`@convex-dev/better-auth`)
- Vitest + Playwright

## Route Layout

- `/auth/*`: sign in/up/reset
- `/onboarding/*`: get started, join club, start club
- `/app/*`: authenticated app area
- Club-scoped routes are canonical under `/club/[clubId]/*` and should be built via `$lib/routes` helpers (`routes.clubHome`, `routes.clubSessions`, etc.) rather than ad-hoc string paths.

### Layout Groups

Routes that share a tab bar use `(tabbed)/` layout groups so non-tabbed siblings do not inherit the tabs. See [ADR-001](adr/001-layout-groups-for-tabbed-routes.md).

```
[clubId]/projects/
├── (tabbed)/          ← Current/Completed tabs
│   ├── current/
│   └── completed/

session/[sessionId]/
├── (tabbed)/          ← Activities/Attendees tabs
│   ├── activities/
│   └── attendees/

project/[projectId]/
├── (tabbed)/          ← Overview/Members tabs
│   ├── overview/
│   └── members/

activity-booklet/      ← browsable activity library (?session= query param for context)
├── [activityId]/      ← activity detail page

feed/
├── (tabbed)/          ← My Clubs/Global tabs
│   ├── my-clubs/
│   └── global/
```

## Domain Modules

- Auth/Profile
- Clubs/Memberships/Permissions
- Sessions/Activities/Attendance
- Projects/Updates
- Preferences/Notifications
- Chat (optional slice after core parity)

## Backend

- `src/convex/schema.ts` defines data model and indexes.
- `src/convex/*.ts` modules expose queries/mutations/actions.
- Client uses generated `api` with `convex-svelte` and authenticated token from hooks.
- Client query convention: import `useStableQuery` from `src/lib/convex/use-stable-query.svelte.ts` instead of `useQuery` directly. Default mode is stale-first (`keepPreviousData: true`) for content continuity during route and param transitions. Pass `{ mode: 'gate' }` for auth/permission gates that should not reuse stale results. Remount cache is opt-in per query via `{ cache: 'memory' }` (default is `'off'`) so only non-sensitive content queries keep last successful data across remounts.
- Club projects tabs (`/club/[clubId]/projects/current` and `/club/[clubId]/projects/completed`) opt into remount caching on `api.projects.listPreviewsByClub` in `src/lib/components/app/projects/club-projects-view.svelte` so project cards (including avatar preview data) stay visible on back-navigation while live data refreshes.
- Auth in `hooks.server.ts` + Better Auth cookie/token integration.
- Global auth readiness gate: root layout hydrates adapter server auth state and app layout gates protected queries/children via `useAuth()` readiness. See [ADR-009](adr/009-global-convex-auth-readiness-gate.md).
- Sensitive values only from server env.

## Forms

Forms use **shadcn-svelte Field.\* components + Superforms + Zod v4** — no Formsnap. See [ADR-002](adr/002-form-architecture.md).

- Schema in a co-located `schema.ts` with Zod v4.
- `defaults(zod4(schema))` for initial form state (server adapter).
- `validators: zod4Client(schema)` for client-side validation (client adapter).
- `SPA: true` because the backend is Convex, not SvelteKit form actions.
- `Field.Label` supports a `required` prop for red asterisk indicators.

## UI Patterns

- **Dialog → Detail Page pattern**: Creation via minimal dialog with "Open" button → create entity → navigate to detail page. Editing happens on the detail page via ActionMenu. See [ADR-003](adr/003-modal-to-page-refactor.md).
- **Project detail tabs**: Project detail uses route-backed tabs (`Overview` and `Members`) with `/project/[projectId]` redirecting to `overview`. See [ADR-008](adr/008-project-detail-tabs.md).
- **Club home session planning**: The `No upcoming sessions` empty state on `/club/[clubId]` opens the same create-session dialog flow used on `/club/[clubId]/sessions` (submit label `Open`), and then routes to `/session/[sessionId]/activities`. The CTA and helper copy are shown only when the viewer has `session:create`.
- **Shared session card surface**: `/club/[clubId]` and `/club/[clubId]/sessions` both render `src/lib/components/app/sessions/club-session-card.svelte` for upcoming/list cards. View-specific differences (for example, hiding attendees or action menu on dashboard) are controlled via component props instead of separate card implementations.
- **Session card data prefetching**: Routes that render session cards should prefer `api.sessions.listCardPreviewsByClub` and pass the entry through `prefetchedCardData` to `ClubSessionCard`. This keeps tags/activity preview/attendee preview in a single query and avoids nested per-card loading flashes.
- **Project card data prefetching**: Routes that render project cards should prefer `api.projects.listPreviewsByClub` and pass `memberPreview` to `ClubProjectCard`. This avoids nested per-card member queries and prevents delayed avatar pop-in after card content renders.
- **Feed update card surface**: `/feed/my-clubs` renders updates through `src/lib/components/app/feed/update-card.svelte`. The related project displays as a small default `Badge` pill, and the related prompt/question displays as orange `type-sm-bold` text above update content. Media attachments are intentionally deferred to a follow-up iteration.
- **Card elevation baseline**: Shared `Card` (`src/lib/components/ui/card/card.svelte`) is intentionally flat by default (no drop shadow). Feature surfaces that need elevation should opt in explicitly with shadow utilities.
- **Page headers** use `PageHeaderBackButton`, `PageHeaderTitle`, `PageHeaderActions` — these communicate with AppShell via Svelte context.
- **Shell-level header title hints**: AppShell supports route-state title seeding via `App.PageState` (`headerTitleHint`, `headerTitleHintPath`) in `src/routes/(app)/+layout.svelte`. Use this when opening an entity detail page from a list/card where the title is already known, so the header renders stable immediately while detail queries resolve. Scope hints to the canonical entity base path (for example `/project/[projectId]`, `/session/[sessionId]`) so nested tabs share the same initial title seed.
- **Card-driven stateful navigation**: Shared clickable `Card` and `DataRecordCard` support `navigationState` and pass it through SvelteKit `goto(..., { state })`. Prefer this over per-feature ad-hoc `goto` wrappers when you need cross-route page state (for example header title hinting).
- **Routing/back semantics**: Explicitly choose `pushState` vs `replaceState` per flow. Contextual completion flows (for example session -> booklet -> add -> session) use replace semantics to avoid stale back-stack entries. Header back behavior relies on SvelteKit history state, not `document.referrer`. See [routing-and-back-navigation.md](routing-and-back-navigation.md) and [ADR-007](adr/007-history-semantics-for-routing-and-back.md).
- **History-driven overlays (mobile back close)**: For sheet/dialog overlays that are scoped to a parent page and should dismiss with browser/mobile back, use SvelteKit shallow routing page state (`pushState('', { ...page.state, overlayOpen: true })`) and close via `history.back()` (with `replaceState` fallback). Prefer fully controlled open-state wiring for Bits UI overlays (`bind:open={getOpen, setOpen}`). See [routing-and-back-navigation.md](routing-and-back-navigation.md) and [ADR-007](adr/007-history-semantics-for-routing-and-back.md).
- **Dialog back-dismiss default**: Shared `Dialog.Root` enables browser/mobile-back-first close behavior by default. Set `closeOnBack={false}` to opt out for specific dialogs.
- **Header search** uses `PageHeaderSearch` to opt in per-page search from AppShell, with responsive `auto` mode that resolves between inline, collapsible, and title-overlay variants. See [ADR-005](adr/005-responsive-page-header-search.md).
- **ActionMenu** provides edit/delete/toggle actions on detail pages via a dropdown triggered by an ellipsis icon.
- **Icon stroke weight policy**: Lucide icons use global stroke tokens from `src/routes/layout.css` (`--icon-stroke-default`, `--icon-stroke-subtle`, `--icon-stroke-strong`). Use `icon-stroke-subtle`/`icon-stroke-strong` classes for intentional exceptions and avoid hard-coded `strokeWidth` literals in feature code. See [ADR-010](adr/010-icon-stroke-weight-policy.md).
- **Field component hierarchy**: `Field.Group > Field.Field > Field.Label + Input + Field.Error + Field.Description`.
- **Session Building Booklet**: Reusable activity templates browsable at `/activity-booklet`, with copy-on-add into sessions, drag-and-drop reordering, and multi-tag filtering that requires activities to match all selected tags (AND semantics). See [ADR-004](adr/004-session-building-booklet.md).
- **Bottom nav clearance**: The app shell defines a `--bottom-nav-h` CSS variable (currently `4.5rem`) on the outermost wrapper. Content padding (`pb-[var(--bottom-nav-h)]`) and sticky floating element offsets (`bottom-[calc(var(--bottom-nav-h,0rem)+1rem)]`) derive from this single value. On desktop (`lg:`) the sidebar replaces the bottom nav and the padding is removed. Pages should not add their own bottom padding for nav clearance.
- **Drag-and-drop reordering**: Session activities use `svelte-dnd-action` for sortable lists with an `order` field persisted via Convex mutation.
- **Dnd shadow rendering guard**: During activity drag start, the temporary shadow item can render for one frame before library shadow decoration. The activities view passes `SHADOW_ITEM_MARKER_PROPERTY_NAME` through list data and cards render shadow rows as `invisible` immediately to avoid UI flash.
- **Toggle chips**: `ToggleGroup` renders as pill-shaped filter chips by default (rounded-full, spaced, wrapping). Used for building block filtering in booklet and activity dialogs.
- **Token chips**: Keep `Badge` as a primitive status component and use `TagChip` for accent/muted pill chips and removable chip interactions. See [ADR-006](adr/006-badge-and-tag-chip-split.md).
- **Mobile pressed behavior**: Interactive primitives should express visual interaction with `hover:*` utilities at the component level. In `src/routes/layout.css`, the global `hover` variant is configured so on coarse-pointer mobile devices those same styles are applied on `:active`, keeping touch pressed feedback aligned with desktop hover without per-instance overrides.
- **Button typography contract**: Shared `Button` size variants map to design-system text tokens in `src/lib/components/ui/button/button.svelte` (`default` → `type-btn`, `sm` → `type-btn-sm`, `lg` → `type-btn-lg`). Feature code should select button `size` instead of attaching ad-hoc text-size/font-weight classes.
- **Inline activity editing**: Session activity cards support inline blur-save editing for title, description, minutes, and building blocks. Building block edits use a reusable searchable inline multi-select (combobox + listbox) at `src/lib/components/ui/multi-select/inline-multi-select.svelte`, composed from shadcn primitives (`Input`) plus reusable token chips (`TagChip`) and accessible listbox roles. Immediate inline-save feedback is driven by Convex mutation `optimisticUpdate` in `session-detail-view`.
- **Connectivity gating (global)**: Mutation-capable surfaces consume `$lib/app/connectivity.ts` (`canMutateOnline`, `connectivityMessage`, `reportMutationSuccess`, `reportMutationFailure`) so editing can be disabled consistently during offline/network-loss states. AppShell renders a persistent reconnect overlay with spinner while disconnected. This is intentionally centralized so a future offline queue/replay mode can be introduced without rewriting each screen.
