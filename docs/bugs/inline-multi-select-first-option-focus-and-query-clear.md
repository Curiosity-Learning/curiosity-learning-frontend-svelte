# Bug: Inline Multi-Select First-Option Focus and Query Reset

## Symptom

In the inline multi-select, typing text did not activate the first filtered option, so Enter/Space required extra navigation first. After selecting an option, the typed query remained in the input, which slowed multi-pick flows.

## Expected Behavior

- While the user types, the first filtered option is active.
- On option selection (keyboard or click), the query text is cleared.
- Input focus remains in place so users can continue typing immediately.

## Implemented Fix

File: `src/lib/components/ui/multi-select/inline-multi-select.svelte`

- Input `oninput` now sets `activeIndex = 0` whenever the trimmed query is non-empty.
- Added `selectOption(optionId)` helper to centralize selection behavior.
- `selectOption` now:
  - toggles the selected option,
  - clears `query`,
  - re-focuses input at caret end.
- Updated keyboard (`Enter`, `Space`) and click selection paths to use `selectOption`.

## Additional Cleanup

To keep Svelte rune usage clean in this component, optimistic-selection cleanup moved from a state-writing `$effect` to a derived value (`effectiveOptimisticSelectedIds`) with the same behavior.
