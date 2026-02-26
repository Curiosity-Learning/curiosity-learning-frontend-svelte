# ADR-010: Lucide Icon Stroke Weight Policy

**Status:** Accepted
**Date:** 2026-02-26

## Context

Icon usage is broad and mostly consistent in the app:

- Lucide is the icon system (`@lucide/svelte/icons`) across product and UI primitives.
- Current audit: 66 Lucide imports across 36 source files.
- Stroke weight had no central policy and only one local hard-coded override (`strokeWidth={2.75}`) in `club-session-card.svelte`.

Without a shared policy, icon visual weight drifts into per-instance literals, making design updates slow and error-prone.

## Decision

Adopt token-driven icon stroke weights for Lucide icons:

- Define global tokens in `src/routes/layout.css`:
  - `--icon-stroke-default` (baseline)
  - `--icon-stroke-subtle` (lighter)
  - `--icon-stroke-strong` (heavier)
- Apply baseline globally to all Lucide icons via `.lucide-icon`.
- Use semantic utility classes for intentional exceptions:
  - `icon-stroke-subtle`
  - `icon-stroke-strong`
- Avoid hard-coded `strokeWidth={...}` literals in feature code.

## Files

| Area | Files |
|------|-------|
| Tokens + global rule | `src/routes/layout.css` |
| Existing strong-emphasis usage migrated to policy | `src/lib/components/app/sessions/club-session-card.svelte` |

## Consequences

- **Positive:** Icon stroke updates can be done in one place by changing token values.
- **Positive:** Exceptions are semantic (`icon-stroke-strong`) instead of numeric literals.
- **Positive:** Easier UI audit and design-system consistency checks.
- **Trade-off:** Lucide icons now share a global stroke rule, so non-standard weights should be intentional and class-based.
