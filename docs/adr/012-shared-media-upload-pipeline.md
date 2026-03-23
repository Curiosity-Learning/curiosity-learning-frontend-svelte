# ADR-012: Shared Media Upload Pipeline

## Status

Accepted - 2026-03-22

## Context

Several user-facing media features are planned next: pledges, session photos, project media, and application videos. The existing codebase had no shared Convex-native media contract. Where file-like behavior existed, it stored raw URLs or arbitrary storage IDs without:

- authoritative metadata validation,
- explicit processing states,
- retry/restart behavior,
- or a shared place to add future compression and safety screening.

That would force each feature to rebuild upload, validation, and recovery logic independently.

## Decision

We will use one shared Convex file-storage pipeline backed by a `mediaAssets` table.

### Upload flow

1. The client calls `media.beginUpload(...)` to create a draft `mediaAssets` row and receive a signed upload URL from `ctx.storage.generateUploadUrl()`.
2. The client uploads the file directly to Convex storage and receives an `Id<"_storage">`.
3. The client calls `media.finalizeUpload(...)` with the storage ID.
4. A scheduled internal mutation processes the upload and transitions it to `ready` or `failed`.

### Stored contract

Each `mediaAssets` record stores:

- owner,
- per-upload constraints (`acceptedContentTypes`, `maxBytes`, processing flags),
- the `Id<"_storage">`,
- derived file metadata (`contentType`, `sizeBytes`, `sha256`),
- a state machine (`pending_upload`, `processing`, `ready`, `failed`, `canceled`),
- step results,
- and explicit failure metadata (`code`, `stage`, `recoverable`, `retryable`).

### Validation and processing

- File metadata is read from the `"_storage"` system table via `ctx.db.system.get("_storage", storageId)`.
- File URLs are not persisted. They are generated at read time with `ctx.storage.getUrl(...)`.
- Each upload record carries its own validated constraints, so feature code can choose MIME and size rules without adding new backend enum values.
- Compression and safety screening are modeled as pipeline steps, but remain no-op hooks until those processors are implemented.

## Rationale

- Convex recommends storing storage IDs, not file URLs.
- Convex best practices prefer queries and mutations over actions when no external side effects are required.
- A scheduled internal mutation keeps this first version deterministic and retry-friendly while still allowing future action-based processors for external services or Node-only tooling.
- Feature-level media work can now focus on product rules and attachment semantics instead of rebuilding transport and validation.

## Consequences

### Positive

- One upload contract for all upcoming media features.
- The shared uploader stays generic instead of growing a new backend `purpose` enum value for every feature surface.
- Failure states are explicit and queryable.
- Users can restart or retry uploads without inventing feature-specific recovery paths.
- Future compression/safety processors can plug into the same pipeline contract.
- Feature ownership remains explicit in domain tables instead of being inferred from optional context metadata on the upload row.

### Trade-offs

- Feature tables still need to decide how they reference `mediaAssets` and enforce domain rules.
- Feature code must create upload sessions with the intended constraints; attachment count and other product rules remain outside the uploader itself.
- When a future processor requires external APIs or Node-only libraries, the pipeline will need to hand off that step to an internal action rather than keeping everything inside mutations.
