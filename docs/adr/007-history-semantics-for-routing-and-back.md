# ADR-007: History Semantics for Routing and Back Navigation

**Status:** Accepted
**Date:** 2026-02-20

## Context

Two regressions exposed inconsistent navigation semantics:

- Header back behavior incorrectly depended on `document.referrer`, causing fallback navigation during in-app SPA transitions.
- Session -> booklet -> add -> session produced extra history entries, requiring multiple back presses and creating duplicate session entries.
- Query-param-driven overlay state for project members sheet was brittle on mobile (URL changed but sheet state could desync), causing open/close races and unreliable back-dismiss behavior.

The product expectation is that completed contextual flows return users to a stable page with intuitive single-step back behavior.

## Decision

### Back button source of truth

Use SvelteKit history metadata (`window.history.state['sveltekit:history']`) to determine whether in-app back navigation is available. Do not rely on `document.referrer` for SPA route transitions.

### History policy for contextual flows

For transient, in-flow navigation steps, use `goto(..., { replaceState: true })` instead of default push semantics.

Applied pattern for session booklet flow:

- session activities -> booklet (replace)
- booklet list -> booklet detail when session-contextual (replace)
- add to session -> session activities (replace)

### Shared component support

Add optional `replaceState` control to shared clickable-card navigation so feature flows can opt into replacement semantics without one-off navigation wrappers.

### History-driven overlays

For contextual overlays that should dismiss with browser/mobile back:

- Model overlay state in `App.PageState` and read via `$app/state` `page.state`.
- Open via shallow routing `pushState('', { ...page.state, overlayOpen: true })`.
- Close via `history.back()` (with `replaceState` fallback when no prior history entry exists).
- For Bits UI overlays, use fully controlled binding (`bind:open={getOpen, setOpen}`) to avoid races between local state and URL/history state.

## Files

| Area | Files |
|------|-------|
| Header back semantics | `src/lib/components/app/app-shell.svelte` |
| Shared card navigation | `src/lib/components/ui/card/card.svelte` |
| Booklet card usage | `src/lib/components/app/sessions/booklet-activity-card.svelte` |
| Booklet list add flow | `src/routes/(app)/activity-booklet/+page.svelte` |
| Booklet detail add flow | `src/routes/(app)/activity-booklet/[activityId]/+page.svelte` |
| Session entry points to booklet | `src/lib/components/app/sessions/session-detail-view.svelte` |
| Practices reference | `docs/routing-and-back-navigation.md` |

## Consequences

- **Positive:** Header back and browser back are aligned for in-app transitions.
- **Positive:** Contextual add flows feel complete and do not leave stale intermediate routes in history.
- **Positive:** Navigation behavior becomes explicit and reviewable (`push` vs `replace`).
- **Positive:** Contextual overlays can be dismissed with Back on mobile without ad-hoc query-param synchronization.
- **Trade-off:** History behavior is now intentionally opinionated per flow; new routes must choose semantics deliberately.
