# Inline Multi-Select Typography + Hit Target (2026-02-22)

## Context

The inline multi-select used in session activity cards had mismatched text hierarchy across selected chips, placeholder text, and dropdown options. On mobile, dropdown options were also harder to tap reliably.

## Changes

- Updated inline multi-select input text/placeholder to use small, regular body typography (`type-sm`) to align with selected tag sizing without bold weight.
- Updated dropdown option text and empty-state copy to `type-sm` for hierarchy consistency.
- Increased dropdown option row height/padding (`min-h-7`, `py-1`) to improve tapability on touch devices.
- Added an inline component comment documenting why dropdown rows intentionally keep extra vertical hit area.

## Files

- `src/lib/components/ui/multi-select/inline-multi-select.svelte`

## Validation

- Manual visual validation in local dev UI.
- No behavior or data-flow changes; styling-only refinement.
