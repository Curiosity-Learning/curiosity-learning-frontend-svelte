# ADR-008: Project Detail Tabs (Overview + Members)

**Status:** Accepted  
**Date:** 2026-02-20

## Context

Project detail previously rendered all content on one page, with members shown inline and then via an expandable/sheet treatment. This created two UX issues:

- Information density and duplication: members competed with updates on the same surface.
- Navigation ambiguity on mobile: back-dismiss behavior for transient overlays was harder to make robust than route-backed navigation.

At the same time, the app already uses route-backed tab patterns for sessions and club projects.

## Decision

Adopt route-backed tabs for project detail:

- `/project/[projectId]/overview`
- `/project/[projectId]/members`
- `/project/[projectId]` redirects to `/overview`

Implementation details:

- Add a `(tabbed)/+layout.svelte` for project tabs using `HeaderTabs` in `PageHeaderBanner`.
- Use a shared `ProjectDetailView` component with `view: 'overview' | 'members'` to keep header/actions/state logic consistent across tabs.
- Keep project-level editing actions available from both tabs through the shared header action menu.

## Files

| Area | Files |
|------|-------|
| Project tab layout | `src/routes/(app)/project/[projectId]/(tabbed)/+layout.svelte` |
| Overview tab page | `src/routes/(app)/project/[projectId]/(tabbed)/overview/+page.svelte` |
| Members tab page | `src/routes/(app)/project/[projectId]/(tabbed)/members/+page.svelte` |
| Base route redirect | `src/routes/(app)/project/[projectId]/+page.ts` |
| Shared project detail view | `src/lib/components/app/projects/project-detail-view.svelte` |

## Consequences

- **Positive:** Removes member/update contention by giving each concern dedicated space.
- **Positive:** Aligns with established route-backed tab architecture used elsewhere in the app.
- **Positive:** Back behavior is now route-native and predictable across desktop/mobile.
- **Trade-off:** Project detail is now multi-route and requires keeping shared view logic centralized.
