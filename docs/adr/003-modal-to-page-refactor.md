# ADR-003: Dialog-to-Detail-Page Pattern

**Status:** Accepted (revised)
**Date:** 2026-02-12

## Context

The app needs a consistent pattern for creating and editing entities (sessions, projects). Several approaches were considered:

- **Modal-only:** Creation and editing happen in dialogs on list pages. Feels cramped for complex entities and mixes display/edit concerns.
- **Dedicated creation pages:** A `/new` page with full forms. Adds URL-addressable creation but creates extra files and feels heavy for simple entities.
- **Draft pattern:** Immediately create a record on "+" and navigate to an editable detail page. Blocked by required fields in the Convex schema.

## Decision

Adopt a **dialog for quick creation → detail page for editing** pattern:

### Creation Dialogs (list pages)

- Minimal fields only (name, dates) with a **"Open"** button.
- On submit: create the entity via Convex mutation, then `goto()` the detail page.
- No edit mode in creation dialogs — they are creation-only.
- Example: sessions list "+" opens a dialog with start time, end time, and description. On "Open", creates the session and navigates to `/session/[id]/activities`.

### Detail Pages (viewing + editing)

- Full viewing experience: description, status, members, content feeds.
- Editing via **ActionMenu → "Edit details"** dialog for name, description, dates.
- Additional actions in ActionMenu (e.g., "Mark as done", "Delete").
- Detail pages are the single place where editing happens — no editing on list pages.

### Inline Dialogs (sub-entities + info)

- **Activities:** Created/edited via dialog within the session detail view (sub-entity of a session).
- **Invite learner:** Info popup for sharing invite codes (no entity creation).
- These stay as dialogs because they are lightweight, contextual, and don't need their own URL.

## What Changed

### Projects

1. Reverted from `/[clubId]/projects/new` page back to a creation dialog in `club-projects-view.svelte`.
2. Created detail page at `/project/[projectId]/+page.svelte` with project info, members, updates feed, and edit dialog.
3. Project cards link to the detail page via `href` prop.

### Sessions

1. Simplified the session list dialog to **creation-only** (removed edit mode, `sessionEditId`, `openEditSession`).
2. "Open" button creates the session and navigates to the detail page.
3. Removed "Edit session" action from `ClubSessionCard` ActionMenu on the list page.
4. Editing stays on the session detail view (already had an edit dialog via ActionMenu).

### Route Helpers

- Removed `clubProjectsNew` from `src/lib/routes.ts`.
- Added `projectDetail: (projectId) => \`/project/${projectId}\``.

## Consequences

- **Positive:** Consistent pattern across entity types — dialogs for quick creation, detail pages for working.
- **Positive:** List pages stay focused on browsing — no edit state management.
- **Positive:** Detail pages are URL-addressable for deep linking and collaboration.
- **Positive:** Component-based edit dialogs on detail pages can be upgraded to inline editing later.
- **Negative:** Two interaction patterns (dialog + page) instead of one, but each serves a distinct purpose.

## When to Apply

| Scenario | Pattern |
|----------|---------|
| Creating a top-level entity (session, project) | Creation dialog on list page → navigate to detail page |
| Editing a top-level entity | ActionMenu + edit dialog on detail page |
| Creating/editing a sub-entity (activity) | Dialog within parent detail page |
| Displaying info (invite code) | Info dialog |
