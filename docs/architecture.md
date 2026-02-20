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

project/[projectId]/   ← single page, no tabs

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
- Auth in `hooks.server.ts` + Better Auth cookie/token integration.
- Sensitive values only from server env.

## Forms

Forms use **shadcn-svelte Field.* components + Superforms + Zod v4** — no Formsnap. See [ADR-002](adr/002-form-architecture.md).

- Schema in a co-located `schema.ts` with Zod v4.
- `defaults(zod4(schema))` for initial form state (server adapter).
- `validators: zod4Client(schema)` for client-side validation (client adapter).
- `SPA: true` because the backend is Convex, not SvelteKit form actions.
- `Field.Label` supports a `required` prop for red asterisk indicators.

## UI Patterns

- **Dialog → Detail Page pattern**: Creation via minimal dialog with "Open" button → create entity → navigate to detail page. Editing happens on the detail page via ActionMenu. See [ADR-003](adr/003-modal-to-page-refactor.md).
- **Club home session planning**: The `No upcoming sessions` empty state on `/club/[clubId]` opens the same create-session dialog flow used on `/club/[clubId]/sessions` (submit label `Open`), and then routes to `/session/[sessionId]/activities`. The CTA and helper copy are shown only when the viewer has `session:create`.
- **Page headers** use `PageHeaderBackButton`, `PageHeaderTitle`, `PageHeaderActions` — these communicate with AppShell via Svelte context.
- **Header search** uses `PageHeaderSearch` to opt in per-page search from AppShell, with responsive `auto` mode that resolves between inline, collapsible, and title-overlay variants. See [ADR-005](adr/005-responsive-page-header-search.md).
- **ActionMenu** provides edit/delete/toggle actions on detail pages via a dropdown triggered by an ellipsis icon.
- **Field component hierarchy**: `Field.Group > Field.Field > Field.Label + Input + Field.Error + Field.Description`.
- **Session Building Booklet**: Reusable activity templates browsable at `/activity-booklet`, with copy-on-add into sessions, drag-and-drop reordering, and multi-tag filtering that requires activities to match all selected tags (AND semantics). See [ADR-004](adr/004-session-building-booklet.md).
- **Bottom nav clearance**: The app shell defines a `--bottom-nav-h` CSS variable (currently `4.5rem`) on the outermost wrapper. Content padding (`pb-[var(--bottom-nav-h)]`) and sticky floating element offsets (`bottom-[calc(var(--bottom-nav-h,0rem)+1rem)]`) derive from this single value. On desktop (`lg:`) the sidebar replaces the bottom nav and the padding is removed. Pages should not add their own bottom padding for nav clearance.
- **Drag-and-drop reordering**: Session activities use `svelte-dnd-action` for sortable lists with an `order` field persisted via Convex mutation.
- **Dnd shadow rendering guard**: During activity drag start, the temporary shadow item can render for one frame before library shadow decoration. The activities view passes `SHADOW_ITEM_MARKER_PROPERTY_NAME` through list data and cards render shadow rows as `invisible` immediately to avoid UI flash.
- **Toggle chips**: `ToggleGroup` renders as pill-shaped filter chips by default (rounded-full, spaced, wrapping). Used for building block filtering in booklet and activity dialogs.
- **Token chips**: Keep `Badge` as a primitive status component and use `TagChip` for accent/muted pill chips and removable chip interactions. See [ADR-006](adr/006-badge-and-tag-chip-split.md).
- **Inline activity editing**: Session activity cards support inline blur-save editing for title, description, minutes, and building blocks. Building block edits use a reusable searchable inline multi-select (combobox + listbox) at `src/lib/components/ui/multi-select/inline-multi-select.svelte`, composed from shadcn primitives (`Input`) plus reusable token chips (`TagChip`) and accessible listbox roles.
- **Connectivity gating (global)**: Mutation-capable surfaces consume `$lib/app/connectivity.ts` (`canMutateOnline`, `connectivityMessage`, `reportMutationSuccess`, `reportMutationFailure`) so editing can be disabled consistently during offline/network-loss states. AppShell renders a persistent reconnect overlay with spinner while disconnected. This is intentionally centralized so a future offline queue/replay mode can be introduced without rewriting each screen.
