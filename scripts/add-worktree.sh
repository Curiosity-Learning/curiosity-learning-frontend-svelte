#!/usr/bin/env bash
set -euo pipefail

usage() {
	cat <<'EOF'
Usage:
  scripts/add-worktree.sh <branch-name> [path] [base-ref]

Creates a git worktree, then runs npm run worktree:setup inside it.
If the branch already exists, base-ref is ignored.
EOF
}

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
	usage
	exit 0
fi

if [ $# -lt 1 ] || [ $# -gt 3 ]; then
	usage
	exit 2
fi

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

branch="$1"
path="${2:-}"
base_ref="${3:-HEAD}"

slug="$(
	printf '%s' "$branch" \
		| tr '[:upper:]' '[:lower:]' \
		| sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//; s/-+/-/g'
)"

if [ -z "$slug" ]; then
	echo "Could not derive a worktree path from branch name: $branch" >&2
	exit 1
fi

if [ -z "$path" ]; then
	path="../$(basename "$repo_root")-worktrees/$slug"
fi

if git show-ref --verify --quiet "refs/heads/$branch"; then
	git worktree add "$path" "$branch"
else
	git worktree add -b "$branch" "$path" "$base_ref"
fi

(
	cd "$path"
	npm run worktree:setup
)

echo "Worktree ready at $path."
