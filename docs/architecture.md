# Architecture

Current app structure and conventions. Keep this file short; use commit history for change history.

## Stack

- SvelteKit, Svelte 5, TypeScript
- Tailwind CSS v4 + shadcn-svelte components
- Convex backend in `src/convex`
- Better Auth with Convex adapter
- SvelteKit Node adapter for production
- Vitest + Playwright

## Routes

- Public auth: `/auth/sign-in`, `/auth/sign-up`, `/auth/reset-password`
- Onboarding: `/onboarding/get-started`, `/onboarding/join-club`, `/onboarding/join-club/[code]`, `/onboarding/join-club/public-clubs`, `/onboarding/start-club`, `/onboarding/post-signup`, `/onboarding/parent-consent/[token]`
- Authenticated routes live in `src/routes/(app)`; the `(app)` group is not part of the URL.
- Main app URLs: `/no-club`, `/club/[clubId]`, `/club/[clubId]/sessions`, `/club/[clubId]/projects`, `/club/[clubId]/members`, `/club/[clubId]/settings`, `/applications/review`, `/feed`, `/chat`, `/profile`, `/settings`, `/notifications`
- Detail URLs: `/session/[sessionId]/activities`, `/session/[sessionId]/attendees`, `/project/[projectId]/overview`, `/project/[projectId]/members`, `/activity-booklet`, `/activity-booklet/[activityId]`
- Legal pages: `/privacy`, `/terms`, `/cookies`

Use helpers in `src/lib/routes.ts` for app navigation instead of hand-built strings.

## Backend

- `src/convex/schema.ts` owns tables and indexes.
- `src/convex/*.ts` modules expose queries, mutations, and actions.
- Prefer indexed reads with `withIndex`; avoid broad `.filter()` scans.
- Client code should import `useStableQuery` from `src/lib/convex/use-stable-query.svelte.ts` instead of importing `useQuery` directly.
- Auth is wired through `src/hooks.server.ts`, Better Auth cookies, and the Convex token integration.
- Keep secrets in environment variables only.

## Media

- Product media attaches by `mediaAssetId`, not raw object keys or public URLs.
- `src/lib/media/media-field.svelte.ts` is the product-facing upload controller.
- `src/lib/media/upload-core.ts` contains the direct-upload lifecycle primitives.
- `src/lib/media/upload-manager.svelte.ts` powers the developer upload test page at `/settings/media-upload-dev`.
- Initial page renders should receive authorized signed media URLs from server loads via `src/lib/server/signed-media.ts`.
- `/api/media/refresh` is for explicit renewal on long-lived pages, not default initial rendering.

## UI

- Use shared shadcn-svelte primitives in `src/lib/components/ui`.
- Use app components in `src/lib/components/app` for shell, headers, forms, cards, onboarding, and domain surfaces.
- Keep spacing gap-based where possible.
- `Button` size variants define button typography; do not attach ad-hoc text sizing to buttons.
- Lucide icon stroke weights are controlled by global CSS tokens in `src/routes/layout.css`.
- Shared `Card` is flat by default; opt into elevation only where a surface truly needs it.
- Use `PageHeaderBackButton`, `PageHeaderTitle`, `PageHeaderActions`, and `PageHeaderSearch` for shell header integration.
- Mutation-capable UI should respect `$lib/app/connectivity.ts`.
- For repeated project/session cards, prefer route-level preview queries over nested per-card query waterfalls.

## Forms

- Use shadcn-svelte `Field.*` primitives with `Input`, `Textarea`, `Select`, and shared app form wrappers where they already fit.
- Superforms + Zod v4 is appropriate for heavier form state; lightweight screens can use local state with shared fields.
- Convex-backed forms usually run as SPA interactions rather than SvelteKit form actions.
- Use `docs/forms.md` for consistent field errors, form alerts, and snackbar placement.

## Navigation

- Route-backed tabs live in `(tabbed)` layout groups.
- Entity creation generally uses a small dialog, then opens the created detail page.
- Editing belongs on detail pages via `ActionMenu` where possible.
- Use SvelteKit history state for header title hints and contextual back behavior.
- Dialogs use browser/mobile back dismissal by default through the shared dialog wrapper.

## Docs

- Keep `README.md` for setup and deployment.
- Keep `AGENTS.md` for workflow expectations.
- Keep this file for current architecture.
- Keep `docs/data-model.md` and `docs/security.md` as concise reference docs.
- Use commit messages and PR descriptions for implementation history.
