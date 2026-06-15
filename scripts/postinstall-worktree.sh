#!/usr/bin/env bash
set -euo pipefail

if [ "${WORKTREE_POSTINSTALL_SETUP:-1}" = "0" ]; then
	exit 0
fi

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
case "$repo_root" in
	"$HOME/.t3/worktrees/"* | "$HOME/.codex/worktrees/"*)
		echo "Detected managed worktree; running worktree setup after npm install."
		WORKTREE_SETUP_INSTALL=0 bash "$repo_root/scripts/setup-worktree.sh"
		;;
	*)
		;;
esac
