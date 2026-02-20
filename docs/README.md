# Docs Index

> **Keep these docs up to date as you work.** See [AGENTS.md](../AGENTS.md) for when and how.

## Quick Reference

| I want to...                             | Read this                                                       |
| ---------------------------------------- | --------------------------------------------------------------- |
| Understand the stack and project layout  | [architecture.md](architecture.md)                              |
| See routes, forms, and UI conventions    | [architecture.md](architecture.md)                              |
| Know why we chose X over Y               | [adr/](adr/) (Architecture Decision Records)                   |
| Look at the data model and tables        | [data-model.md](data-model.md)                                  |
| Understand permissions and access control| [security.md](security.md)                                      |
| Check migration progress from Flutter    | [implementation-plan.md](implementation-plan.md)                |
| See what's been done and tested          | [qa-log.md](qa-log.md)                                          |
| Check Flutter parity status              | [parity-matrix.md](parity-matrix.md)                            |
| Implement routing/back correctly         | [routing-and-back-navigation.md](routing-and-back-navigation.md)|
| See visual screenshots                   | [screenshots/](screenshots/)                                    |

## Architecture Decision Records

When a significant design choice is made, it gets an ADR in `adr/`:

- [ADR-001](adr/001-layout-groups-for-tabbed-routes.md) — Layout groups for tabbed routes
- [ADR-002](adr/002-form-architecture.md) — Form architecture (Field.* + Superforms + Zod)
- [ADR-003](adr/003-modal-to-page-refactor.md) — Modal-to-page refactor for creation flows
- [ADR-004](adr/004-session-building-booklet.md) — Session building booklet (reusable activity library)
- [ADR-005](adr/005-responsive-page-header-search.md) — Responsive page-header search modes
- [ADR-006](adr/006-badge-and-tag-chip-split.md) — Keep `Badge` primitive and centralize token-chip behavior in `TagChip`
- [ADR-007](adr/007-history-semantics-for-routing-and-back.md) — Back/history semantics for contextual flows
- [ADR-008](adr/008-project-detail-tabs.md) — Project detail tabs (`Overview` / `Members`)
