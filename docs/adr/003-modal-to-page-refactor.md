# ADR-003: Modal-to-Page Refactor for Creation Flows

**Status:** Accepted
**Date:** 2026-02-12

## Context

Project creation was originally implemented as a modal dialog inside `club-projects-view.svelte`. This pattern has several downsides:

- **No URL** — the creation state is not addressable or shareable.
- **Limited space** — complex forms with validation, descriptions, and helper text feel cramped in a dialog.
- **Mixed concerns** — the list view component manages both display and creation logic.
- **No back button** — users cannot navigate away and return to a partially filled form.

## Decision

Refactor creation flows from modals into **dedicated route pages**.

### What Changed

1. **Created a new route** at `/[clubId]/projects/new/+page.svelte` with the full form.
2. **Removed dialog code** from `club-projects-view.svelte` — all dialog state, form state, mutation logic, and the `<Dialog.Root>` template block.
3. **Changed the trigger** from `onclick={openCreateProject}` to `href={clubId ? \`/${clubId}/projects/new\` : undefined}` on the "+" button.
4. **Added route helper** `clubProjectsNew` in `src/lib/routes.ts`.

### Page Header Pattern

The new page uses the existing `PageHeader*` components to integrate with the AppShell:

```svelte
<PageHeaderBackButton fallbackHref="/{clubId}/projects/current" />
<PageHeaderTitle title="Add project details" />
<PageHeaderActions none />
```

These components communicate with the AppShell via Svelte context to control the top navigation bar.

## Consequences

- **Positive:** Creation forms have their own URL, enabling deep linking and browser navigation.
- **Positive:** Full page real estate for form layout, validation messages, and helper text.
- **Positive:** List view components stay focused on display logic only.
- **Positive:** Clean separation works naturally with layout groups (ADR-001) — the creation page sits outside `(tabbed)/` and does not inherit the tab bar.
- **Negative:** Slightly more files (route page + schema), but the separation is worth it.

## When to Apply

Use dedicated pages (not modals) for any creation or editing flow that:
- Has more than 2-3 form fields
- Needs validation and error messages
- Benefits from a URL (bookmarking, sharing, back button)
- Would feel cramped in a dialog
