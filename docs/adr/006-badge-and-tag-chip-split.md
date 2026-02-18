# ADR-006: Badge Primitive + TagChip Wrapper

**Status:** Accepted
**Date:** 2026-02-18

## Context

Tag-like UI surfaces in sessions and activity planning needed behavior beyond a status badge:

- accent/muted chip tones,
- optional leading icon (decorative),
- optional removable action (`x`) with accessible labeling,
- consistent chip styling across list cards, booklet detail, and inline multi-select.

Using `Badge` with repeated per-instance class overrides created drift and made chip behavior harder to reason about.

## Decision

Keep `Badge` as a simple primitive and introduce a dedicated `TagChip` wrapper:

- `Badge`: base primitive for generic status labels.
- `TagChip`: token-chip semantics and styling (`tone`, icon snippets, optional remove action).

Multi-select selected items render `TagChip` chips and use `TagChip`'s built-in removable mode for in-chip remove UX.

## Files

| Area | Files |
|------|-------|
| Primitive | `src/lib/components/ui/badge/badge.svelte` |
| New wrapper | `src/lib/components/ui/badge/tag-chip.svelte` |
| Exports | `src/lib/components/ui/badge/index.ts` |
| Multi-select adoption | `src/lib/components/ui/multi-select/inline-multi-select.svelte` |
| Session/list adoption | `src/lib/components/app/record-card/relation-chip-set.svelte` |
| Session/list adoption | `src/lib/components/app/home/upcoming-session-card.svelte` |
| Session/list adoption | `src/lib/components/app/sessions/session-activity-card.svelte` |
| Session/list adoption | `src/routes/(app)/activity-booklet/[activityId]/+page.svelte` |

## Consequences

- **Positive:** Chip visuals/behavior are centralized in one component API.
- **Positive:** Most call sites now use attributes (`tone`, `removable`) instead of custom class strings.
- **Positive:** Future chip enhancements (variants, icon policy, accessibility updates) can be made in one place.
- **Trade-off:** Adds one wrapper component, but removes repeated per-instance style logic.
