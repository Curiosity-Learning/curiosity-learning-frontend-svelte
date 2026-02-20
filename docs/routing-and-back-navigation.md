# Routing and Back Navigation Practices

## Why this exists

This guide captures routing/back-navigation lessons from recent regressions so new flows do not reintroduce confusing history behavior.

## Key learnings

- Browser history behavior must be designed, not assumed.
- In SvelteKit, `goto(...)` defaults to `pushState` and will create a new back-stack entry unless `replaceState: true` is set.
- Contextual flows (for example session -> booklet -> add -> session) often need history replacement to feel like a completed task, not a branch the user must unwind manually.
- `document.referrer` is not reliable for SPA in-app navigation checks.
- For overlays (sheet/dialog) that should dismiss via Back on mobile, use shallow routing page state (`pushState('', state)`) instead of query-param toggles.

## Rules

1. Build app routes with `src/lib/routes.ts` helpers.
2. Default to `pushState` for user-browseable pages that should remain in history.
3. Use `replaceState: true` for transient or terminal steps:
   - contextual pickers launched from a parent page,
   - confirmation-style transitions that should return to a stable parent route,
   - "complete action and return" flows.
4. For app-header back behavior, rely on SvelteKit in-app history metadata (`sveltekit:history`) rather than `document.referrer`.
5. Always provide deterministic `fallbackHref` values for explicit back buttons.
6. Preserve context with query params (`?session=...`) only while needed, then collapse history on exit.
7. For history-driven overlays, prefer `App.PageState` + `pushState('', ...)` + `history.back()` close semantics.

## Decision matrix

- Use `goto(url)`:
  - user is navigating to a new destination they may want to revisit with Back.
- Use `goto(url, { replaceState: true })`:
  - user is in an in-flow step that should not persist as a separate back entry.

## Session booklet pattern

- Enter booklet from session: `replaceState: true`.
- Navigate booklet list -> detail in session context: `replaceState: true`.
- Add to session and return: `replaceState: true`.

Result: back from the returned session page goes to the page before entering the flow, not through booklet internals.

## History-driven overlay pattern (sheet/dialog)

Use this for overlays that are contextual to the current page and should close with browser/mobile Back (for example project members sheet).

### Open

- Add a shallow history entry with page state:
  - `pushState('', { ...page.state, yourOverlayOpen: true })`

### Close

- Close by unwinding history:
  - `history.back()`
- If no back entry is available (direct load edge-case), fallback to:
  - `replaceState('', { ...page.state, yourOverlayOpen: false })`

### Control wiring

- Read open state from `page.state.yourOverlayOpen === true`.
- For Bits UI sheet/dialog, use fully controlled function binding:
  - `bind:open={getOpen, setOpen}`
- In setter, only write history when requested state differs from current derived state.
- Shared `Dialog.Root` now defaults to back-dismiss behavior; set `closeOnBack={false}` only when a dialog must not consume Back.

## QA checklist for new flows

- Does browser Back match user expectation after flow completion?
- Does header Back match browser Back in the same state?
- Are there duplicate destination entries after return?
- Are fallbacks correct for direct loads/bookmarks (no prior in-app history)?
- Are contextual query params removed/collapsed after terminal actions?
- For overlays: does Back close the overlay first before leaving the page?
