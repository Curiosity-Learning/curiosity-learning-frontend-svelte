# Agent Instructions (Curiosity Learning SvelteKit)

These instructions exist to keep iteration fast while still shipping production-quality code.

## Default Dev Workflow (Speed First)

- Prefer a **tight loop**: make changes, refresh the running app, and only run checks when there is a reason.
- Do **not** run full E2E/screenshot suites after every small UI tweak.
- Keep `npm run dev` and `npm run dev:backend` running in separate terminals during active development.

## One Ticket = One Worktree = One Branch = One PR

All work is tracked in Fibery (`Software Development/Ticket`, ids `CL-###`).

- **Start from a ticket.** No ticket, no code: create one first (or ask Ron). A request that
  covers several tickets becomes several worktrees.
- **One worktree per ticket**, created by T3, Claude Code or `npm run worktree:add`. It gets its
  own Convex backend and URL automatically (see `docs/worktrees.md`).
- **One branch per ticket**, named after the ticket's `Git Branch` field:
  `<assignee>/cl-<id>-<short-name>` (e.g. `ron/cl-778-application-seasons`). Rename an
  auto-named branch (`t3/…`, `claude/…`) before the first push. Branch from `origin/main`.
- **One PR per ticket**, titled `CL-###: <outcome>`, with the Fibery ticket link in the body.
  Something unrelated found along the way gets its own ticket, not a commit in this branch.
- **Keep the ticket current** as the work moves:
  - worktree created → state `In Progress`, comment with the branch name;
  - PR opened → state `Implemented`, comment with the PR link and the Vercel branch preview URL;
  - Ron testing on the preview → `In Testing` → `Tested`;
  - merged and deployed → `Done`, with a comment listing any deploy steps that were run (prod env
    vars, data backfills, `syncRolePermissions --prod`, …).
- **Clean up** after the merge: `npm run worktree:remove` (deletes the worktree's backend).

## Backends: never share, never prod

- In a worktree, `npx convex dev` / `npx convex run` / `npx convex data` already target the
  worktree's own backend. Do not copy `.env.local` from the main checkout or another worktree, and
  do not pass `--deployment good-echidna-357`: shared dev is for the main checkout only.
- If `.env.local` is missing or points at `good-echidna-357`, run `npm run worktree:setup`.
- Never use `--prod` (or the prod deployment) without Ron's explicit OK in the chat.
- Test in the worktree URL (`http://<worktree>.localhost:<port>`), then on the PR's Vercel branch
  preview. Both have their own copy of the dev data, so seed or change data freely there.

## Testing Policy (When To Run What)

- **Tight loop (most edits)**:
  - No commands; validate by refreshing the app in the browser.
- **Medium gate (feature is ready to try / before asking user to test)**:
  - `npm run check`
  - Optional: `npm run lint:fast`
- **Hard gate (milestone / before calling a feature done)**:
  - `npm run lint`
  - `npm test` (unit + Playwright)

## Fast Commands (Preferred)

- Typecheck: `npm run check`
- Fast lint (cached): `npm run lint:fast`
- Unit-only: `npm run test:quick`
- E2E against an already-running server (no build/preview boot): `npm run test:e2e:local`
  - Set `E2E_BASE_URL` to point at the server under test.

## Where Speed Optimizations Live

- Scripts: `package.json`
- Local e2e config (no webServer): `playwright.local.config.ts`
- E2E base URL override: `e2e/smoke-and-screenshots.test.ts` (reads `E2E_BASE_URL`)

## Repo Conventions

When working in this repo:

- UI work: follow the local shadcn-svelte conventions (shared components, gap-based spacing, avoid margin utilities).
- Backend work: follow the Convex conventions in `docs/convex_rules.txt` (indexes via `withIndex`, no `.filter()`, correct validators, etc).
- Auth work: follow the Better Auth notes in `docs/security.md` (trusted origins, secrets, email flows).
- Browser validation/screenshots: use the configured browser/Playwright tooling when explicitly requested or when verifying complex flows.
- Keep durable context in commit history instead of long-running planning docs.

## Commit Log

Use high-quality commits as the project log.

- Commit after each coherent change when the user asks you to commit or when the workflow clearly calls for a checkpoint.
- Prefer small, reviewable commits over broad mixed-purpose commits.
- Write commit subjects that explain the user-visible or engineering outcome, not just the files changed.
- Use the commit body for context that would otherwise become stale docs: why the change was made, trade-offs, follow-up risks, and validation run.
- Keep `docs/architecture.md`, `docs/data-model.md`, and `docs/security.md` current only when the present-day system changes.

## Notes / Guardrails

- Keep secrets out of the repo. Use Convex env vars for backend secrets.
- LAN dev (if needed): Better Auth origin checks should remain strict in production. Any widened dev-only origin patterns should be guarded by an explicit env flag.
