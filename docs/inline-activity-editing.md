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

## Future considerations

- **Rich text (Tiptap):** If bold, lists, or links are needed in activity
  descriptions, the `contentEditable` can be replaced with a Tiptap editor.
  The `content` field would store HTML strings (still `v.string()`). The
  save-on-blur and optimistic guard patterns remain the same.
- **Collaborative cursors:** For true multi-cursor editing, a CRDT layer
  (e.g. Yjs with `convex-yjs`) would be needed. The current approach is
  last-write-wins per field, which is appropriate for short-form notes.
