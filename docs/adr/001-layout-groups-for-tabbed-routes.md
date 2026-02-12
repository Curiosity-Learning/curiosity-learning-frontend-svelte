# ADR-001: Layout Groups for Tabbed Routes

**Status:** Accepted
**Date:** 2026-02-12

## Context

Several routes in the app use a tab bar layout (e.g., Projects has Current/Completed tabs, Feed has My Clubs/Global tabs, Sessions have Activities/Attendees tabs). When a new child route was added (e.g., `/projects/new`), the tab bar from the parent `+layout.svelte` was inherited, which was incorrect — the "new project" page should not show tabs.

A quick fix (conditionally hiding tabs based on `$page.url.pathname`) was considered but rejected as unsustainable. Every new non-tabbed child route would require another conditional check.

## Decision

Use **SvelteKit layout groups** to separate tabbed and non-tabbed routes. Tabbed routes are placed inside a `(tabbed)/` directory that contains its own `+layout.svelte` with the tab bar. Non-tabbed routes sit outside `(tabbed)/` and inherit from the parent layout without tabs.

Layout groups use parentheses in the directory name (e.g., `(tabbed)/`) which means they **do not affect the URL** — they only control which layout is applied.

## Structure

```
routes/(app)/[clubId]/projects/
├── (tabbed)/
│   ├── +layout.svelte      ← tab bar lives here
│   ├── current/+page.svelte
│   └── completed/+page.svelte
├── new/+page.svelte         ← no tabs, inherits from parent layout
└── +page.ts                 ← redirect

routes/(app)/session/[sessionId]/
├── (tabbed)/
│   ├── +layout.svelte
│   ├── activities/+page.svelte
│   └── attendees/+page.svelte

routes/(app)/feed/
├── (tabbed)/
│   ├── +layout.svelte
│   ├── my-clubs/+page.svelte
│   └── global/+page.svelte
```

## Consequences

- **Positive:** Adding new non-tabbed child routes (e.g., `/projects/[id]/edit`) requires no changes to the tab layout — just place them outside `(tabbed)/`.
- **Positive:** No fragile conditional path checks in layout components.
- **Positive:** Follows the official SvelteKit pattern for layout composition.
- **Negative:** Slightly deeper directory nesting, but the intent is clear from the directory name.

## When to Apply

Any time a route group uses a shared layout element (tabs, sidebars, sub-navigation) that should not apply to all sibling routes, wrap the routes that need the shared element in a named layout group.
