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

### Layout Groups

Routes that share a tab bar use `(tabbed)/` layout groups so non-tabbed siblings (e.g., creation pages) do not inherit the tabs. See [ADR-001](adr/001-layout-groups-for-tabbed-routes.md).

```
[clubId]/projects/
├── (tabbed)/          ← Current/Completed tabs
│   ├── current/
│   └── completed/
└── new/               ← no tabs

session/[sessionId]/
├── (tabbed)/          ← Activities/Attendees tabs
│   ├── activities/
│   └── attendees/

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

Reference implementation: `src/routes/(app)/[clubId]/projects/new/+page.svelte`.

## UI Patterns

- **Creation flows use dedicated pages**, not modals. See [ADR-003](adr/003-modal-to-page-refactor.md).
- **Page headers** use `PageHeaderBackButton`, `PageHeaderTitle`, `PageHeaderActions` — these communicate with AppShell via Svelte context.
- **Field component hierarchy**: `Field.Group > Field.Field > Field.Label + Input + Field.Error + Field.Description`.
