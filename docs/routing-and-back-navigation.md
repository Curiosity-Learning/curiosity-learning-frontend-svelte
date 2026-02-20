# Routing and Back Navigation Practices

## Why this exists

This guide captures routing/back-navigation lessons from recent regressions so new flows do not reintroduce confusing history behavior.

## Key learnings

- Browser history behavior must be designed, not assumed.
- In SvelteKit, `goto(...)` defaults to `pushState` and will create a new back-stack entry unless `replaceState: true` is set.
- Contextual flows (for example session -> booklet -> add -> session) often need history replacement to feel like a completed task, not a branch the user must unwind manually.
- `document.referrer` is not reliable for SPA in-app navigation checks.

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

## QA checklist for new flows

- Does browser Back match user expectation after flow completion?
- Does header Back match browser Back in the same state?
- Are there duplicate destination entries after return?
- Are fallbacks correct for direct loads/bookmarks (no prior in-app history)?
- Are contextual query params removed/collapsed after terminal actions?
