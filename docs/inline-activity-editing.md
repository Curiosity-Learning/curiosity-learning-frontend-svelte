# Inline Activity Editing (Realtime via Convex)

## Overview

Session activities support inline editing directly on the activity card:

- Title (`name`) via single-line inline text input
- Description (`content`) via multiline `contentEditable` paragraph
- Minutes (`minutes`) via number input
- Building blocks via reusable searchable multi-select (chips + input + listbox)

Edits are persisted to Convex and pushed to all connected viewers in realtime
via Convex's `useQuery` subscriptions.

This enables collaborative session planning — two leaders can open the same
session simultaneously and see each other's changes appear as they edit.

## How it works

### Editing flow

1. User edits a field directly on the card.
2. On blur (or focus-leave for building blocks), the card compares local value
   vs current activity value.
3. If changed, an async inline-save callback fires, which calls
   `upsertActivity`.
4. Convex persists and pushes updates to all subscribers.
5. Other viewers receive new values through `useQuery` subscriptions.

### Key implementation details

| Concern | Approach |
|---------|----------|
| **Initial content** | The description `<p contenteditable>` renders `{activity.content ?? ''}` inline — NOT populated on mount by `$effect`. See drag-and-drop notes below. |
| **Title line control** | The title uses an inline `<input type="text">` so it stays single-line and avoids contenteditable caret quirks. |
| **Minutes input** | Minutes are edited with an inline `<input type="number">` and only persisted on blur. Empty clears the field. |
| **Building blocks** | A reusable searchable multi-select shows removable in-chip tags (`TagChip` + `x`), supports typing to filter options, and persists selection on focus leave. |
| **Connectivity policy** | For now, inline editing is online-only. Session views use the shared connectivity module to disable editing while offline or when the backend is unreachable. Inputs remain visible in-place (for layout consistency) but are disabled until reconnect. |
| **Optimistic guard** | Last-saved guards prevent stale Convex values from briefly overwriting local blur saves. |
| **Conflict avoidance** | Remote sync is skipped while the user is actively editing each field. Last-write-wins on blur/close. |
| **Error handling** | If the mutation rejects (e.g. offline), `lastSaved` clears so the element reverts, and a "Save failed" message appears. Focusing again clears the error for retry. |
| **Placeholder** | CSS `empty:before` pseudo-element with `data-placeholder` attribute. No JS needed. |
| **Permissions** | Inline editors render only when update callbacks are present and user has `session_activity:update`. |

### Data storage

Inline updates mutate the existing `sessionActivities` row through
`upsertActivity`:

- `name`: required string
- `content`: optional string (`undefined` when empty)
- `minutes`: optional number (`undefined` when empty)
- `buildingBlockIds`: optional array of building block ids

## Files

| File | Role |
|------|------|
| `src/lib/components/app/sessions/session-activity-card.svelte` | Card component with inline editors, blur-save handlers, optimistic guards, and remote sync |
| `src/lib/components/ui/multi-select/inline-multi-select.svelte` | Reusable shadcn-based searchable multi-select used for inline building block edits and other future multi-select surfaces |
| `src/lib/components/ui/badge/tag-chip.svelte` | Reusable token chip wrapper around `Badge` for accent/muted tag styles, optional icons, and removable chip actions |
| `src/lib/components/app/sessions/session-detail-view.svelte` | Parent view — passes `onContentSave` callback that calls `upsertActivity` mutation |
| `src/convex/sessions.ts` | `upsertActivity` mutation — persists activity fields (`name`, `content`, `minutes`, building block links) |

## Interaction with drag-and-drop

Activity cards are reorderable via `svelte-dnd-action` with a dedicated drag
handle (`dragHandleZone` + `dragHandle` action). This creates a subtle timing
constraint for `contentEditable` elements:

### The problem: empty clone on drag start

`svelte-dnd-action` clones the dragged card's DOM element synchronously when
drag starts. If the `contentEditable` `<p>` starts empty and is populated later
by a Svelte `$effect`, the clone captures the wrong (shorter) height. The
library then animates the height correction via its `morph` function, causing a
visible shrink-then-grow flash.

**Why it happens:** When the drag handle is pressed, `svelte-dnd-action`
toggles `dragDisabled` from `true` to `false`, which triggers a Svelte
re-render of the keyed `{#each}` block. The re-rendered card component mounts
with an empty `<p>` — the `$effect` that would populate it is queued but hasn't
run yet. The library clones this short element.

### The fix: render initial content inline

The `<p>` renders `{activity.content ?? ''}` as its text child so the content
is part of the initial HTML — present before any JS runs:

```svelte
<p contenteditable="true" ...>{activity.content ?? ''}</p>
```

The `$effect` is kept for subsequent remote Convex updates. On the first run it
sees that `contentEl.innerText` already matches and is a no-op.

### Things to watch for

- **Don't remove the inline text child.** If someone refactors the
  `contentEditable` back to an empty `<p>` populated by `$effect`, the
  drag-start height flash will return.
- **Svelte reactive text vs imperative writes.** Svelte tracks the
  `{activity.content}` text node and will update it when the prop changes.
  During editing this is harmless because `activity.content` (the prop) doesn't
  change until after blur → mutation → Convex push. If a *remote* update arrives
  mid-edit, Svelte's reactive text node could theoretically clobber the user's
  input — but the `$effect` has the same race window, and it's extremely
  unlikely for two users to type in the same field simultaneously.
- **If adding more imperative DOM content** (e.g. replacing `contentEditable`
  with Tiptap), ensure the editor populates synchronously on mount, not in an
  async lifecycle hook.

## Future considerations

- **Rich text (Tiptap):** If bold, lists, or links are needed in activity
  descriptions, the `contentEditable` can be replaced with a Tiptap editor.
  The `content` field would store HTML strings (still `v.string()`). The
  save-on-blur and optimistic guard patterns remain the same.
- **Collaborative cursors:** For true multi-cursor editing, a CRDT layer
  (e.g. Yjs with `convex-yjs`) would be needed. The current approach is
  last-write-wins per field, which is appropriate for short-form notes.
