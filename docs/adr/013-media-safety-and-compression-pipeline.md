# ADR-013: Lean Media Safety and Compression Pipeline

## Status

Accepted - 2026-03-22

## Context

ADR-012 introduced a shared `mediaAssets` upload foundation, but compression and safety screening were still placeholders and project update attachments still stored raw storage IDs. The product requirement for CL-685 is to keep the implementation lean while ensuring uploaded media is validated, compressed, safety-screened, and either approved or rejected before feature code can use it.

The team explicitly wanted:

- a flexible constraint-based uploader instead of a large preset registry,
- binary moderation in v1 (`approved` or `rejected`),
- broader existing format support preserved unless a feature narrows it,
- and no admin review surface in this branch.

## Decision

We will extend the shared uploader in place rather than replace it.

### Upload contract

- `media.beginUpload(...)` remains constraint-based.
- Upload constraints now support `maxDurationSeconds?` alongside `acceptedContentTypes`, `maxBytes`, `enableCompression`, and `enableSafetyScreening`.
- The backend remains authoritative by validating all requested constraints before creating an upload session.

### Processing flow

1. The client uploads the original file into Convex storage.
2. `media.finalizeUpload(...)` records that raw blob as `sourceStorageId` and schedules a Node-side internal action.
3. The action reads the blob, validates MIME from file bytes plus storage metadata, enforces size and optional duration limits, compresses media, runs AWS Rekognition moderation, and stores the processed result back into Convex storage.
4. Only an upload with `status === "ready"` and `moderationStatus === "approved"` is considered usable by feature code.
5. Rejected uploads do not become normal attachments or file URLs.

### Feature wiring

- `updateFiles` now references `mediaAssetId`, not raw `storageId`.
- Project update attachments are allowed only for owner-controlled uploads that are already approved and satisfy the project-update upload policy.
- Other future media surfaces will reuse the same shared uploader contract when they are implemented.

## Consequences

### Positive

- Media safety and compression are enforced before normal feature use.
- The uploader stays flexible without adding a preset enum for every new feature.
- Project updates no longer trust raw storage IDs.
- The moderation result is isolated so a future review state can be added later without redesigning the upload API.

### Trade-offs

- Binary moderation is intentionally simpler than the future review workflow.
- The branch adds AWS Rekognition operational dependencies for safety screening.
- Broader format support means some image formats may compress less aggressively until a richer cross-format image toolchain is introduced.
