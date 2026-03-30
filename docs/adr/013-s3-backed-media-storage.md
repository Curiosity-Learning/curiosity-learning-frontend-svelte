# ADR-013: S3-Backed Shared Media Storage

## Status

Accepted - 2026-03-28

## Context

ADR-012 established a shared media upload pipeline, but its first implementation used Convex file storage and stored `Id<"_storage">` values as the canonical blob reference. That coupling would force follow-up work such as compression, moderation, and cleanup to keep translating feature behavior through Convex-specific blob APIs.

The next phase needs a storage foundation where:

- Convex remains the control plane for upload lifecycle, policy validation, and asset status.
- S3 is the canonical object store for raw uploads, processed outputs, and resolved download URLs.
- Feature code continues to attach only `mediaAssetId`, without depending on provider object keys or Convex `_storage` identifiers.

## Decision

We will keep the shared media API conceptually stable while moving blob storage to S3.

### Control plane

Convex continues to own:

- `beginUpload`
- `finalizeUpload`
- `retryProcessing`
- `cancelUpload`
- `mediaAssets` lifecycle/status
- scheduled upload processing

### Blob storage

S3 becomes the canonical media store:

- `beginUpload` now creates a `mediaAssets` row plus an S3 presigned upload descriptor.
- `finalizeUpload` verifies the expected S3 object exists and only needs `assetId`.
- `mediaAssets` stores provider-neutral object references (`storageProvider`, `sourceObjectKey`, `processedObjectKey`, optional bucket fields) instead of Convex storage IDs.
- Ready asset URLs resolve from S3-backed object metadata.

### Object layout

- One S3 bucket is used by default.
- Object keys include environment, owner, asset id, and upload revision.
- Restarting an upload generates a new object key revision rather than reusing the old path.

## Rationale

- Compression and moderation work should build on a real shared object store instead of a Convex-specific blob abstraction.
- Presigned S3 uploads preserve the direct-upload browser flow while removing `_storage` from the public contract.
- Keeping lifecycle state in Convex preserves explicit status transitions, retries, and feature-level gating on `mediaAssetId`.
- Provider-neutral asset references make later storage evolution possible without leaking object-store details into product code.

## Consequences

### Positive

- Shared upload flow remains `begin -> upload -> finalize -> poll`.
- Feature code can keep referencing `mediaAssetId` only.
- S3 cleanup, verification, and future processing steps live behind one shared contract.

### Trade-offs

- `beginUpload`, `finalizeUpload`, and `cancelUpload` now use action-backed storage operations instead of pure mutation-only storage calls.
- Final download URL resolution depends on S3 configuration rather than Convex file URLs.
- S3 credentials and bucket configuration are now required backend environment.
