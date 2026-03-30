# ADR-015: Shared Media Field Controller

## Status

Accepted

## Context

The S3-backed media pipeline already centralized backend storage, processing, and delivery, but product pages still duplicated page-level upload orchestration. Settings, post-signup, and start-club each owned their own file constraints, preview lifecycle, upload timing, and `mediaAssetId` persistence rules.

That duplication created inconsistent behavior:

- settings uploaded and persisted immediately
- onboarding selected locally and persisted later
- page code had to reason about `pending_upload -> processing -> ready`
- replacing files or abandoning uploads had no shared orphan-cleanup contract

## Decision

Adopt a three-layer client media write architecture:

1. `upload-core.ts` owns pure upload primitives and lifecycle polling
2. `upload-manager.svelte.ts` remains a debug/developer surface on top of that core
3. `media-field.svelte.ts` exposes a per-instance `createMediaField(...)` controller for product pages

`FileDropZone` remains a UI primitive only. Product pages consume shared field definitions and controller state instead of implementing upload orchestration themselves.

The controller exposes both uploaded and attachable state:

- `assetId`
- `assetStatus`
- `hasUploadedAsset`
- `isReady`
- `phase`

Persistence is mediated through `persistAttached(...)`, so controller attachment bookkeeping is tied to the page’s domain mutation success path rather than manual caller flags.

Server-side orphan cleanup is enforced by a dedicated delete path that only deletes owner-owned uploads when they are not referenced by:

- `profiles.profileImageMediaAssetId`
- `clubs.videoMediaAssetId`

## Consequences

- product pages no longer reimplement upload/finalize/wait logic
- UI validation and backend constraints stay aligned through shared field definitions
- deferred flows like onboarding can keep files local until submit
- replacing or clearing unattached uploads performs shared best-effort cleanup
- the debug upload page can continue to exercise low-level media operations without becoming the product API
