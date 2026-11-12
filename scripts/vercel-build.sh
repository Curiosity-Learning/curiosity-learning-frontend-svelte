#!/usr/bin/env bash
# Vercel build command (vercel.json). Production is unchanged: deploy Convex functions to prod,
# then build. Preview builds use the branch's own Convex preview backend (CONVEX_DEPLOY_KEY in
# Vercel's Preview environment is a *preview* deploy key). See docs/worktrees.md.
set -euo pipefail

if [ "${VERCEL_ENV:-}" != "preview" ]; then
	exec npx convex deploy --cmd-url-env-var-name PUBLIC_CONVEX_URL --cmd 'npm run build'
fi

# 1. Push this branch's functions and schema first. `convex deploy --cmd` runs its command BEFORE
#    pushing, so seeding inside it would import data that the schema check then rejects. The
#    command here only records the preview backend's URL.
url_file="$(mktemp)"
npx convex deploy --preview-name "$VERCEL_GIT_COMMIT_REF" --cmd-url-env-var-name PUBLIC_CONVEX_URL \
	--cmd "printenv PUBLIC_CONVEX_URL > '$url_file'"
PUBLIC_CONVEX_URL="$(cat "$url_file")"
export PUBLIC_CONVEX_URL
rm -f "$url_file"

# 2. Point auth at the branch URL, seed shared dev data on the first build, build the app.
exec node scripts/worktree/cli.mjs preview-build
