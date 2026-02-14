# Bug: Ghost Action Menu Button Flash on Drag Start

**Status:** Resolved (2026-02-13)
**Component:** `session-detail-view.svelte` / `session-activity-card.svelte`
**Library:** `svelte-dnd-action` v0.9.69 with `dragHandleZone` + `dragHandle`

## Symptom

When dragging an activity card, the `⋮` action menu button briefly appears at
the card's original position for one frame before disappearing. It looks like a
ghost/duplicate button flash.

## Root Cause (confirmed via debug logging)

`svelte-dnd-action` manages three DOM elements during drag:

1. **Dragged clone** — a `cloneNode(true)` copy of the card, `position: fixed`,
   appended to the document root. Has its own `⋮` button (inert — no event
   listeners).
2. **Shadow element** — the Svelte-rendered replacement in the `{#each}` list.
   The library applies `visibility: hidden` to this element via
   `decorateShadowEl()` so it acts as an invisible placeholder.
3. **Original element** — the card that was dragged. The library keeps it in
   the DOM (re-appended to body, hidden via `display: none`) because touch
   events continue firing on it.

### The timing gap

The shadow element receives `visibility: hidden` inside the `configure()`
function (line 640 of `pointerAction.js`), which runs when the dndzone action's
`update` lifecycle fires after Svelte re-renders. But the first `consider`
event (trigger: `DRAG_STARTED`) is dispatched **before** that `configure()`
call completes for the shadow element.

**Sequence:**

```
handleDragStart()
  → createDraggedElementFrom(originalDragTarget)  // clone created
  → originDropZoneRoot.appendChild(draggedEl)      // clone visible
  → keepOriginalElementInDom via rAF               // scheduled, not immediate
  → items.splice(currentIdx, 1, shadowElData)      // shadow data injected
  → dispatchConsiderEvent()                        // fires consider event
    → handleDndConsider()                          // our handler runs
    → Svelte re-renders {#each}                    // shadow element created in DOM
    → dndzone configure() runs                     // iterates children
      → decorateShadowEl()                         // visibility: hidden applied HERE
```

During the gap between the shadow element being rendered in the DOM (Svelte
re-render) and `decorateShadowEl()` running, **both the shadow's `⋮` button
and the clone's `⋮` button are visible at the same position.** The clone
overlays the shadow, but the `⋮` button can still flash through depending on
rendering order and compositing.

### Debug evidence

Console logging of all `button[aria-haspopup]` elements in the document at
consider time showed:

**First consider event (5 buttons):**
```
btn[0] top:16   parentVis:undefined  isInDragClone:false  // page header menu
btn[1] top:176  parentVis:''         isInDragClone:false  // SHADOW — NOT hidden yet
btn[2] top:449  parentVis:''         isInDragClone:false  // card 2
btn[3] top:675  parentVis:''         isInDragClone:false  // card 3
btn[4] top:176  parentVis:''         isInDragClone:true   // clone (same position)
```

**Second consider event (6 buttons):**
```
btn[1] top:176  parentVis:'hidden'   isInDragClone:false  // shadow — NOW hidden
btn[5] top:960  parentVis:''         isInDragClone:false  // original (re-appended)
```

`btn[1]` has `parentVis: ''` (empty string, not `'hidden'`) on the first event,
confirming the one-frame gap.

## Attempted Fixes and Why They Failed

### Attempt 1: CSS rule hiding `button[aria-haspopup]` inside `.dnd-active` zone

Added `class:dnd-active={isDragging}` to the zone container and a scoped CSS
rule:

```css
:global(.dnd-active) :global(button[aria-haspopup]) {
  visibility: hidden;
}
```

**Result: Failed.** This hid ALL action menu buttons on ALL cards in the zone
during drag — not just the shadow's. The non-dragged cards lost their `⋮`
buttons, which looked broken.

**Why:** The CSS selector is too broad. There's no way to distinguish the shadow
element from other cards via CSS on the first frame because the
`data-is-dnd-shadow-item` attribute is set in the same `configure()` call that
applies `visibility: hidden` — same timing issue.

### Attempt 2: Hide the action menu on the dragged clone via `transformDraggedElement`

```js
el.querySelector('button[aria-haspopup]')?.style.setProperty('display', 'none');
```

**Result: Failed.** The clone's `⋮` button was hidden, but the shadow's `⋮`
button was still visible for one frame at the original position — which is the
actual ghost. Hiding the clone's button made the flash MORE noticeable because
there was no longer a clone button overlaying/masking the shadow's button.

**Why:** The ghost is on the SHADOW element, not the clone. Hiding the clone
just removes the mask.

### Why the shadow attribute approach won't work

`svelte-dnd-action` sets `data-is-dnd-shadow-item="true"` on the shadow
element, but this happens in `decorateShadowEl()` — the same function that
sets `visibility: hidden`. Both are applied at the same time, so a CSS rule
targeting the attribute has exactly the same timing gap.

## Constraints

- The `consider` event fires before the library's own shadow-hiding logic runs.
  We cannot change the library's internal sequencing without forking it.
- The shadow element is a regular Svelte-rendered component — we have no way to
  distinguish it from other cards in the DOM until the library marks it.
- The dragged clone is a `cloneNode(true)` snapshot — its buttons are inert
  (no event listeners), but visually identical.
- `transformDraggedElement` only has access to the clone, not the shadow.
- The `keepOriginalElementInDom` rAF adds another element to the document that
  briefly has a visible button before being hidden.

## Possible Approaches to Explore

1. **Fork or patch `svelte-dnd-action`** to call `decorateShadowEl()` before
   dispatching the first `consider` event, or to apply `visibility: hidden`
   synchronously during `handleDragStart()` before the re-render.

2. **Use `MutationObserver`** on the zone to detect new children appearing
   during drag and immediately apply `visibility: hidden` before the browser
   paints. This would catch the shadow element the moment Svelte inserts it.

3. **CSS `content-visibility: hidden`** or `opacity: 0` with a transition of
   `0s` on a container class — but this still requires distinguishing the
   shadow from other cards.

4. **Delay the clone's appearance** by one frame (add it to the DOM with
   `opacity: 0`, then set `opacity: 1` in a rAF) so it only becomes visible
   after the shadow has been hidden. This would need to happen inside the
   library's code or via `transformDraggedElement` timing tricks.

5. **Move the ActionMenu to a portal** so the trigger button renders outside
   the card's DOM tree — then `cloneNode(true)` wouldn't capture it, and the
   shadow's button would also be outside the `visibility: hidden` scope.
   This is a significant architectural change.

## Implemented Fix

We fixed this without forking `svelte-dnd-action` by using shadow-item data
from the `consider` payload instead of waiting for shadow DOM attributes:

1. Import `SHADOW_ITEM_MARKER_PROPERTY_NAME` in
   `session-detail-view.svelte`.
2. Treat dnd list items as optionally containing the shadow marker field.
3. Pass `isDndShadowItem={activity[SHADOW_ITEM_MARKER_PROPERTY_NAME] === true}`
   to `SessionActivityCard`.
4. In `session-activity-card.svelte`, render shadow cards with
   `class="... invisible"` on the root card.

This hides the shadow row immediately when Svelte renders it on the first
`consider` event, preserving layout but preventing the one-frame `⋮` flash
before `decorateShadowEl()` runs.

## Files

| File | Role |
|------|------|
| `src/lib/components/app/sessions/session-detail-view.svelte` | Parent view with `dragHandleZone` config |
| `src/lib/components/app/sessions/session-activity-card.svelte` | Card component with ActionMenu |
| `src/lib/components/app/action-menu.svelte` | Wraps shadcn DropdownMenu (trigger button + portal content) |
| `node_modules/svelte-dnd-action/src/pointerAction.js` | Library drag handling — `handleDragStart`, `configure`, `decorateShadowEl` |
| `node_modules/svelte-dnd-action/src/helpers/styler.js` | `createDraggedElementFrom`, `decorateShadowEl`, `hideElement` |
| `node_modules/svelte-dnd-action/src/wrappers/withDragHandles.js` | `dragHandleZone` and `dragHandle` actions |
