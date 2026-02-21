# ADR-009: Global Convex Auth Readiness Gate

## Status

Accepted

## Context

Protected Convex queries were occasionally firing before Convex auth hydration completed on the client.
This produced transient `Unauthenticated` errors (for example on `clubs:getMyClubs`, `clubs:getActiveClubContext`, and `updates:listForViewer`) even when the user had a valid Better Auth session.

We previously mitigated this in individual pages by adding local query gates, but that approach duplicated logic and left similar races possible elsewhere.

## Decision

Adopt a global auth-readiness pattern:

1. Root layout now provides server auth state to the Convex Better Auth Svelte adapter.
   - `src/routes/+layout.server.ts` returns `authState` via `getAuthState(createAuth, cookies)`.
   - `src/routes/+layout.svelte` passes `getServerState` to `createSvelteAuthClient`.
2. The authenticated app layout gates protected queries and child rendering on adapter auth readiness.
   - `src/routes/(app)/+layout.svelte` uses `useAuth()`.
   - Protected layout queries use `skip` until `!auth.isLoading && auth.isAuthenticated`.
   - Child routes are not rendered until auth is ready, preventing early protected query execution.
3. Route-level one-off auth bootstrap patches are removed where redundant.
   - Feed no longer requires an extra `auth:getCurrentUser` pre-query gate.

## Consequences

- Prevents duplicate per-page auth-readiness workarounds.
- Reduces transient unauthenticated query failures during hydration.
- Keeps feed/pages simpler by relying on one consistent readiness source.
- Requires protected top-level layouts/pages to follow the same pattern when they introduce new protected queries.
