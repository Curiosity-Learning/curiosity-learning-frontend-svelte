# Environments, worktrees and previews

Every piece of work runs against its own Convex backend. Nothing a feature branch does can
change another branch's functions, schema or data, and nothing touches production until it is
merged to `main`.

| Where                 | App URL                                | Convex backend                                          | Data                                  |
| --------------------- | -------------------------------------- | ------------------------------------------------------- | ------------------------------------- |
| Production (`main`)   | production domain                      | `dependable-albatross-999` (prod)                       | real                                  |
| PR / branch preview   | Vercel branch URL (`…-git-<branch>-…`) | a Convex **preview** backend per branch (auto-deleted)  | copy of shared dev on the first build |
| Worktree (local)      | `http://<worktree>.localhost:<port>`   | a Convex **dev** backend per worktree (`dev/wt-<name>`) | copy of shared dev at setup           |
| Main checkout (local) | `http://localhost:5173`                | `good-echidna-357` (shared dev)                         | shared test data                      |

Shared dev (`good-echidna-357`) is the source of test data and backend secrets. Feature work
should not deploy to it. It is what the main checkout and the admin app (`:4174`) use.

## Worktrees

A new worktree sets itself up automatically, whichever tool creates it:

- **T3 Code**: the project's "Worktree setup" script runs on worktree creation.
- **Claude Code**: the `SessionStart` hook in `.claude/settings.json` runs `ensure`.
- **Codex**: `.codex/environments/environment.toml` runs `npm run worktree:setup`.
- **By hand**: `npm run worktree:add -- ron/cl-123-short-name` (branches from `origin/main`).
- Fallbacks: `npm install` (postinstall) and `npm run dev` (predev) both run `ensure`.

Setup (`scripts/worktree/cli.mjs`, ~2 min for a fresh worktree, mostly `npm install`):

1. installs dependencies;
2. copies the main checkout's `.env` (local app settings), minus anything that picks a backend;
3. creates the Convex dev backend `dev/wt-<worktree-folder>` (or reuses it);
4. copies **all** env vars from shared dev onto it (Resend, S3, Google, auth secret…), with
   `BETTER_AUTH_URL` and `PUBLIC_CONVEX_SITE_URL` pointing at this worktree;
5. pushes this branch's functions and schema;
6. copies the shared dev data in (users, clubs, the `cl-e2e-*` test accounts and passwords).
   Fields that shared dev has but this branch's schema does not are dropped and listed (shared
   dev often runs code from an unmerged branch);
7. writes `.env.local` with the backend, a fixed port and the worktree URL.

Then:

```sh
npm run dev          # app on http://<worktree>.localhost:<port>  (printed at start)
npx convex dev       # watches src/convex and pushes to THIS worktree's backend only
```

Use the printed `*.localhost` URL, not `localhost:5173`. Each worktree gets its own hostname so
browser cookies (sessions) do not leak between worktrees, and its backend only trusts that
origin. Email/password and magic links work; Google sign-in does not (its redirect URIs only
allow the real domains and `localhost:5173`).

Other commands:

```sh
npm run worktree:status         # every worktree, its backend and URL; orphaned backends
npm run worktree:refresh-data   # replace this worktree's data with a fresh copy of shared dev
npm run worktree:setup -- --refresh-env   # recopy env vars from shared dev
npm run worktree:remove [path]  # delete the worktree's backend and the worktree (branch kept)
npm run worktree:prune [--yes]  # delete backends whose worktree is gone (dry run without --yes)
```

Removing a worktree from T3 or Claude Code does not delete its backend; run
`npm run worktree:prune -- --yes` from time to time.

## Vercel previews

`vercel.json` runs `scripts/vercel-build.sh`. Production builds are unchanged
(`npx convex deploy` to prod, then `npm run build`). Preview builds:

1. deploy the branch's functions to its Convex preview backend (named after the branch, reused
   across pushes; Convex deletes inactive previews automatically);
2. point that backend's `BETTER_AUTH_URL` at the branch's stable Vercel URL;
3. on the branch's first build, copy shared dev data in (same field-dropping as worktrees);
4. build the app.

Open the **branch URL** (`curiosity-learning-frontend-svelte-git-<branch>-curiosity-learning.vercel.app`)
to sign in. The per-commit URLs do not match `BETTER_AUTH_URL`, so sign-in fails there.

Configuration (already set up 2026-11-10):

- Vercel, Preview environment: `CONVEX_DEPLOY_KEY` (a Convex **preview** deploy key, name
  `vercel-preview`) and `CONVEX_DEV_SEED_KEY` (a deploy key for shared dev, used only to export
  test data).
- Convex project → Default environment variables → Preview: the shared dev secrets (everything
  except `BETTER_AUTH_URL` and `PUBLIC_CONVEX_SITE_URL`, which the build sets per preview).

Previews use the dev Resend key, so emails from a preview are really sent, as on shared dev.

## Why it is built this way

The first attempt (June 2026) created a backend per worktree but only for Codex/T3 folder paths.
It copied env vars from stale local files, so new backends had no email or S3 keys, and it
started them with an empty database. Worktrees therefore fell back to shared dev, where branches
kept overwriting each other's functions (CL-776).
