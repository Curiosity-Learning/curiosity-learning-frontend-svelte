# ADR-014: CloudFront Signed URL Media Delivery

## Status

Accepted - 2026-03-29

## Context

The first secure-media read implementation used CloudFront signed cookies behind a shared `/media/[assetId]` route. That worked in cloud environments, but it imposed a brittle local-development workflow because sibling-domain cookie delivery does not map cleanly to `localhost`.

At the same time, the app still loads most feature data through browser-side Convex queries rather than server `load` functions, which makes a cookie-only media contract awkward to integrate without broad routing rewrites.

## Decision

We will use **CloudFront signed URLs** as the protected media delivery mechanism.

- CloudFront, OAC, the private S3 origin, the ACM certificate, and the trusted key group remain in place.
- SvelteKit server code mints short-lived signed URLs after authorization.
- UI consumers bind directly to signed URLs plus `expiresAt`, not a shared redirect route.
- Signed URL refresh is handled by `/api/media/refresh`.
- TTLs are media-aware:
  - images use a short TTL
  - videos use a longer minimum TTL and can scale with duration when metadata is available

## Rationale

- Signed URLs work cleanly in both localhost development and cloud environments.
- The existing CloudFront/OAC setup remains valuable; only the delivery contract changes.
- Server-side URL minting keeps the signing key out of Convex and out of browser code.
- Feature/domain reads can stay storage-agnostic by continuing to reference `mediaAssetId`.

## Consequences

### Positive

- One delivery model works in both local and deployed environments.
- The app no longer depends on a cookie-specific `/media/[assetId]` route.
- Media URLs can be refreshed proactively before expiry.

### Trade-offs

- Signed URLs are bearer tokens for their lifetime, so authorization must happen before minting.
- Feature surfaces that render protected media need a server-backed enrichment path or refresh endpoint.
- The app now needs to manage URL expiry and refresh in the UI layer.
