#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
case "$repo_root" in
	"$HOME/.t3/worktrees/"*) ;;
	*) exit 0 ;;
esac

cd "$repo_root"

has_env=0
if [ -f .env.local ] && grep -q '^PUBLIC_CONVEX_URL=' .env.local && grep -q '^CONVEX_DEPLOYMENT=' .env.local; then
	has_env=1
fi

has_modules=0
if [ -d node_modules ] && [ -f node_modules/.package-lock.json ]; then
	has_modules=1
fi

if [ "$has_env" -eq 1 ] && [ "$has_modules" -eq 1 ]; then
	exit 0
fi

echo "t3 worktree is missing env files or node_modules; running worktree setup."
WORKTREE_POSTINSTALL_SETUP=0 bash scripts/setup-worktree.sh
