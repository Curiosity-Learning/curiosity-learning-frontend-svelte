# ADR-011: Render Node Runtime

## Status

Accepted

## Context

The app uses SvelteKit server hooks, `+server.ts` endpoints, and server-side loads for Better Auth and Convex token bootstrap. Those runtime requirements make the production deployment a server-rendered Node application rather than a static export.

Render is the selected hosting target for the frontend. To keep deploy behavior explicit and reproducible, the repository should encode the production runtime choice instead of relying on adapter auto-detection.

## Decision

- Use `@sveltejs/adapter-node` for production builds.
- Deploy the frontend to Render as a `Web Service`.
- Use:
  - build command: `npm install && npm run build`
  - start command: `node build/index.js`
- Keep the environment variable names stable across environments.
- Store frontend runtime configuration in Render and backend/provider secrets in Convex deployment env where required by backend code.

## Consequences

### Positive

- Production runtime behavior matches the app's server-side requirements.
- Render configuration is explicit and reviewable.
- The team has a single deployment contract for local verification, staging, and production.

### Trade-offs

- The app is no longer positioned as a static-host deployment target.
- Production deploy correctness now depends on keeping Render and Convex environment values aligned, especially for auth URLs and secrets.

## Operational Notes

- `BETTER_AUTH_SECRET` must match between the Render service and the corresponding Convex deployment.
- `BETTER_AUTH_URL` must always be the public URL for the specific environment.
- `ALLOW_LAN_TRUSTED_ORIGINS` must stay `false` outside local development.
