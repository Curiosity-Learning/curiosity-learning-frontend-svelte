# ADR-004: Session Building Booklet

**Status:** Accepted
**Date:** 2026-02-13

## Context

Guides plan sessions by adding activities, but creating every activity from scratch is repetitive. The team wanted a reusable library of activity templates ("booklet") that guides can browse, filter, and copy into sessions.

Key design questions:

- **Routing:** Should the booklet live under `/session/[id]/booklet` (nested) or at `/activity-booklet?session=id` (top-level with query param)?
- **Data relationship:** Should session activities reference booklet activities or be independent copies?
- **Filtering:** How should guides browse activities by building block category?

## Decision

### Routing: query param approach

The booklet lives at `/activity-booklet` as a standalone browsable page. When accessed from a session, the session ID is passed as a query param (`?session=sessionId`). This keeps URLs clean, allows the booklet to be used independently, and avoids deeply nested routes.

```
/activity-booklet                      ← standalone browsing
/activity-booklet?session=abc123       ← browsing with "Add to session" context
/activity-booklet/[activityId]         ← activity detail
/activity-booklet/[activityId]?session=abc123
```

### Data: copy-on-add

When a booklet activity is added to a session, it is **copied** into a new `sessionActivity` record along with its building block links. The `bookletActivityId` field preserves traceability but the session activity is fully independent — editing it does not affect the booklet template.

### Filtering: ToggleGroup chips

Building block categories are rendered as pill-shaped toggle chips using shadcn-svelte `ToggleGroup` (multi-select, outline variant). Activities are filtered client-side by matching all selected block names (AND semantics).

### Session activities: drag-and-drop reordering

Activities in a session can be reordered via drag-and-drop using `svelte-dnd-action`. An `order` field on `sessionActivities` persists the sort order, with fallback to `_creationTime` for backward compatibility.

## Files

| Area | Files |
|------|-------|
| Backend | `src/convex/booklet.ts` (listActivities, getActivity, addToSession) |
| Backend | `src/convex/sessions.ts` (reorderActivities mutation, order-aware listActivities) |
| Schema | `src/convex/schema.ts` (bookletActivities, bookletActivityBuildingBlocks, order field) |
| Routes | `src/lib/routes.ts` (activityBooklet, activityBookletDetail) |
| UI | `src/routes/(app)/activity-booklet/+page.svelte` (list page) |
| UI | `src/routes/(app)/activity-booklet/[activityId]/+page.svelte` (detail page) |
| UI | `src/lib/components/app/sessions/booklet-activity-card.svelte` (card component) |
| UI | `src/lib/components/app/sessions/session-detail-view.svelte` (empty state, DnD, booklet link) |
| Seed | `src/convex/bootstrap.ts` (20 example booklet activities) |

## Consequences

- **Positive:** Guides can quickly plan sessions from a curated library instead of starting from scratch.
- **Positive:** Copy-on-add means session activities can be freely customized without affecting templates.
- **Positive:** Query param routing keeps the booklet browsable as a standalone page.
- **Positive:** Drag-and-drop reordering gives guides control over activity sequence.
- **Negative:** Copied activities don't receive upstream template updates (acceptable trade-off for session independence).
