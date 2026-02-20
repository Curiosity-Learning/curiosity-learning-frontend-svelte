# Session Activity Minutes Input

## Summary

The minutes field on session activity cards now uses one consistent input surface in both editable and non-editable states.

## Behavior

- The minutes control always renders as a number input with an inline `mins` suffix.
- The input is disabled when inline editing is not available (`!inlineEditingEnabled || editingDisabled`).
- Native browser number steppers are hidden so the value and suffix render cleanly.
- The `mins` unit remains visible even when the input is empty.

## Implementation

- Component: `src/lib/components/app/sessions/session-activity-card.svelte`
- Minutes input classes include:
  - `pr-9` for suffix room
  - `[appearance:textfield]`
  - `[&::-webkit-inner-spin-button]:appearance-none`
  - `[&::-webkit-outer-spin-button]:appearance-none`
