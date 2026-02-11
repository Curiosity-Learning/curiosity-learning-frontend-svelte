# Architecture

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

## Domain Modules

- Auth/Profile
- Clubs/Memberships/Permissions
- Sessions/Activities/Attendance
- Projects/Updates
- Preferences/Notifications
- Chat (optional slice after core parity)

## Backend Boundaries

- `src/convex/schema.ts` defines data model and indexes.
- `src/convex/*.ts` modules expose queries/mutations/actions.
- Client uses generated `api` with `convex-svelte` and authenticated token from hooks.

## Security Model

- Auth in `hooks.server.ts` + Better Auth cookie/token integration.
- Server-side guards enforce membership and role permissions.
- Sensitive values only from server env.
