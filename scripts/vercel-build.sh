#!/usr/bin/env bash
# Vercel build command (vercel.json). Production is unchanged: deploy Convex functions to prod,
# then build. Preview builds deploy to the branch's own Convex preview backend (CONVEX_DEPLOY_KEY
# in Vercel's Preview environment is a *preview* deploy key), point its auth at the branch URL,
# seed it with shared dev data on the first build, then build. See docs/worktrees.md.
set -euo pipefail

if [ "${VERCEL_ENV:-}" = "preview" ]; then
	exec npx convex deploy --preview-name "$VERCEL_GIT_COMMIT_REF" --cmd-url-env-var-name PUBLIC_CONVEX_URL \
		--cmd 'node scripts/worktree/cli.mjs preview-build'
fi

exec npx convex deploy --cmd-url-env-var-name PUBLIC_CONVEX_URL --cmd 'npm run build'
