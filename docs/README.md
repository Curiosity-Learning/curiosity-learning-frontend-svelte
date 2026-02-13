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
| See visual screenshots                   | [screenshots/](screenshots/)                                    |

## Architecture Decision Records

When a significant design choice is made, it gets an ADR in `adr/`:

- [ADR-001](adr/001-layout-groups-for-tabbed-routes.md) — Layout groups for tabbed routes
- [ADR-002](adr/002-form-architecture.md) — Form architecture (Field.* + Superforms + Zod)
- [ADR-003](adr/003-modal-to-page-refactor.md) — Modal-to-page refactor for creation flows
- [ADR-004](adr/004-session-building-booklet.md) — Session building booklet (reusable activity library)
