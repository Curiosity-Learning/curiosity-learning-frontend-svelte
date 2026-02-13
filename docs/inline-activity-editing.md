# Inline Activity Editing (Realtime via Convex)

## Overview

Session activity descriptions support inline editing directly on the activity
card. Edits are persisted to Convex on blur and pushed to all connected viewers
in realtime via Convex's `useQuery` subscriptions.

This enables collaborative session planning — two leaders can open the same
session simultaneously and see each other's changes appear as they edit.

## How it works

### Editing flow

1. User taps the activity description (a `contentEditable` paragraph).
2. User types freely, including line breaks (Enter key).
3. User taps away (blur) — the card compares the current text to the stored
   value.
4. If changed, the `onContentSave` async callback fires, which calls the
   `upsertActivity` Convex mutation.
5. Convex persists the update and pushes it to all subscribers.
6. Other viewers' cards pick up the new `activity.content` via their
   `useQuery` subscription, and the `$effect` in the card syncs it into
   the DOM.

### Key implementation details

| Concern | Approach |
|---------|----------|
| **Initial content** | The `<p contenteditable>` renders `{activity.content ?? ''}` as an inline text child — NOT populated by `$effect`. See "Interaction with drag-and-drop" below. |
| **Line breaks** | `innerText` (not `textContent`) preserves `\n` from Enter. `whitespace-pre-wrap` renders them. |
| **Optimistic guard** | `lastSaved` holds the just-saved value to prevent the sync `$effect` from reverting to stale Convex data while the mutation is in flight. Cleared once Convex confirms. |
| **Conflict avoidance** | Sync is skipped while the element is focused (`isEditing`). Last-write-wins on blur. |
| **Error handling** | If the mutation rejects (e.g. offline), `lastSaved` clears so the element reverts, and a "Save failed" message appears. Focusing again clears the error for retry. |
| **Placeholder** | CSS `empty:before` pseudo-element with `data-placeholder` attribute. No JS needed. |
| **Permissions** | `contentEditable` only renders when `canEdit && onContentSave` — otherwise a static `<p>` is shown. |

### Data storage

Content is stored as a plain string (`v.optional(v.string())`) in the
`sessionActivities.content` field. Line breaks are `\n` characters within
the string. No HTML or rich text is stored.

## Files

| File | Role |
|------|------|
| `src/lib/components/app/sessions/session-activity-card.svelte` | Card component with contentEditable, blur-save, optimistic guard, and remote sync |
| `src/lib/components/app/sessions/session-detail-view.svelte` | Parent view — passes `onContentSave` callback that calls `upsertActivity` mutation |
| `src/convex/sessions.ts` | `upsertActivity` mutation — persists `content` field |

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
