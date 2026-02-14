# ADR-005: Responsive Page Header Search Modes

**Status:** Accepted
**Date:** 2026-02-14

## Context

Search UI existed as page-specific implementations (sessions/projects), each with its own icon toggle and in-body input. This created duplication and made header behavior inconsistent across routes.

The product requirement is a header-level search that pages can opt into like other header overrides, with three interaction modes for responsive behavior:

- Icon that expands into an input and autofocuses.
- Always-open inline input that does not obstruct other header controls.
- Intentional full title overlap input for narrow layouts, while preserving the back button lane.

## Decision

### API: context-driven like existing header controls

Add a dedicated header search override channel through `PAGE_HEADER_CTX`, parallel to actions/title/banner/back:

- `PageHeaderSearch` sets search config from a page.
- `AppShell` renders the search control.
- Pages bind search text (`bind:value`) and keep filtering logic local.

This preserves existing ownership boundaries:

- Header rendering and responsive layout behavior stay in one place (`AppShell`).
- Page-level filtering and query semantics stay in the page/component.

### Modes

`PageHeaderSearch` supports `mode`:

- `inline`: always-open search field in the right action area.
- `collapsible`: icon button that expands to input (expanding left of the icon), autofocuses on open, and collapses on focus loss when empty.
- `overlay`: icon-triggered search field that overlays the title region when opened, left-aligned to the title lane and offset to avoid the back button.
- `auto` (default): `AppShell` resolves mode from header width.

### Auto mode strategy

`auto` resolves by available header width:

- wide: `inline` (open by default)
- medium: `collapsible` (icon-triggered)
- narrow: `overlay` (icon-triggered)

This keeps the control usable without ad-hoc per-page breakpoint logic.

## Files

| Area | Files |
|------|-------|
| Context API | `src/lib/app/page-header.ts` |
| Layout controller wiring | `src/routes/(app)/+layout.svelte` |
| Shell rendering + responsive mode selection | `src/lib/components/app/app-shell.svelte` |
| Page opt-in component | `src/lib/components/app/page-header-search.svelte` |
| Component exports | `src/lib/components/app/index.ts` |
| Adoption | `src/lib/components/app/projects/club-projects-view.svelte` |
| Adoption | `src/routes/(app)/club/[clubId]/sessions/+page.svelte` |

## Consequences

- **Positive:** Consistent header search behavior across pages with one implementation path.
- **Positive:** Pages opt in declaratively (`PageHeaderSearch`) and keep their own filtering logic.
- **Positive:** Responsive behavior is centralized and can evolve without changing every page.
- **Trade-off:** `auto` uses shell width thresholds; exact cutovers are heuristic and may be tuned with future UX feedback.
