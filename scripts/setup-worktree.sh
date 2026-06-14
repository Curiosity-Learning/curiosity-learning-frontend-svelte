#!/usr/bin/env bash
set -euo pipefail

usage() {
	cat <<'EOF'
Usage:
  scripts/setup-worktree.sh [--seed-env]

Options:
  --seed-env  Save this worktree's ignored env files into the private git env store.

Environment overrides:
  WORKTREE_SETUP_INSTALL=0        Skip npm install.
  WORKTREE_SETUP_CONVEX=0         Skip Convex deployment creation/selection.
  WORKTREE_SETUP_CONVEX_ENV=0     Skip pushing env vars to the selected Convex deployment.
  WORKTREE_CONVEX_PROJECT_REF=... Prefix refs with team:project, e.g. my-team:my-project.
  WORKTREE_CONVEX_REF_PREFIX=...  Default: dev/<user>-worktree.
  WORKTREE_CONVEX_EXPIRATION=...  Used only when the installed Convex CLI supports --expiration.
EOF
}

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

git_common_dir="$(git rev-parse --git-common-dir)"
case "$git_common_dir" in
	/*) ;;
	*) git_common_dir="$repo_root/$git_common_dir" ;;
esac

env_store="$git_common_dir/worktree-env"
env_files=(.env .env.local .env.test)

slugify() {
	printf '%s' "$1" \
		| tr '[:upper:]' '[:lower:]' \
		| sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//; s/-+/-/g' \
		| cut -c 1-48
}

seed_env() {
	mkdir -p "$env_store"
	chmod 700 "$env_store"

	local copied=0
	local env_file
	for env_file in "${env_files[@]}"; do
		if [ -f "$env_file" ]; then
			cp "$env_file" "$env_store/${env_file#.}"
			chmod 600 "$env_store/${env_file#.}"
			copied=1
		fi
	done

	if [ "$copied" -eq 0 ]; then
		echo "No local env files found to seed."
		return 1
	fi

	echo "Saved ignored env files to $env_store."
}

restore_env() {
	if [ ! -d "$env_store" ]; then
		echo "No private env store found. Run npm run worktree:seed from a configured worktree first."
		return 0
	fi

	local env_file
	for env_file in "${env_files[@]}"; do
		local stored="$env_store/${env_file#.}"
		if [ -f "$stored" ] && [ ! -f "$env_file" ]; then
			cp "$stored" "$env_file"
			chmod 600 "$env_file"
			echo "Restored $env_file."
		fi
	done
}

convex_cli_supports() {
	local command="$1"
	local option="$2"
	npx convex $command --help 2>/dev/null | grep -q -- "$option"
}

build_convex_env_file() {
	local output="$1"
	shift

	awk -F= '
		/^[[:space:]]*#/ || /^[[:space:]]*$/ { next }
		/^[A-Za-z_][A-Za-z0-9_]*=/ {
			key = $1
			value = substr($0, index($0, "=") + 1)
			if (value == "" || value == "...") next
			if (key ~ /^(CONVEX_DEPLOYMENT|CONVEX_DEPLOY_KEY|PUBLIC_CONVEX_URL|PUBLIC_MAPBOX_ACCESS_TOKEN|PUBLIC_SENTRY_DSN|PUBLIC_SENTRY_ENVIRONMENT|SENTRY_ENVIRONMENT)$/) next
			vars[key] = value
			if (!(key in seen)) {
				order[++count] = key
				seen[key] = 1
			}
		}
		END {
			for (i = 1; i <= count; i++) {
				key = order[i]
				if (key in vars) print key "=" vars[key]
			}
		}
	' "$@" >"$output"
}

push_convex_env() {
	if [ "${WORKTREE_SETUP_CONVEX_ENV:-1}" = "0" ]; then
		return 0
	fi

	local sources=()
	[ -f "$env_store/env" ] && sources+=("$env_store/env")
	[ -f "$env_store/env.local" ] && sources+=("$env_store/env.local")
	[ -f .env ] && sources+=(.env)
	[ -f .env.local ] && sources+=(.env.local)

	if [ "${#sources[@]}" -eq 0 ]; then
		return 0
	fi

	local temp_env
	temp_env="$(mktemp)"
	build_convex_env_file "$temp_env" "${sources[@]}"

	if [ -s "$temp_env" ]; then
		npx convex env set --from-file "$temp_env"
	fi

	rm -f "$temp_env"
}

setup_convex() {
	if [ "${WORKTREE_SETUP_CONVEX:-1}" = "0" ]; then
		return 0
	fi

	local raw_user raw_name user_slug name_slug ref
	raw_user="${USER:-dev}"
	raw_name="$(basename "${CODEX_WORKTREE_PATH:-$PWD}")"
	user_slug="$(slugify "$raw_user")"
	name_slug="$(slugify "$raw_name")"

	if [ -z "$name_slug" ]; then
		name_slug="worktree"
	fi

	ref="${WORKTREE_CONVEX_REF_PREFIX:-dev/${user_slug:-dev}-worktree}/$name_slug"
	if [ -n "${WORKTREE_CONVEX_PROJECT_REF:-}" ]; then
		ref="$WORKTREE_CONVEX_PROJECT_REF:$ref"
	fi

	local expiration_args=()
	if [ -n "${WORKTREE_CONVEX_EXPIRATION:-}" ] && convex_cli_supports "deployment create" "--expiration"; then
		expiration_args=(--expiration "$WORKTREE_CONVEX_EXPIRATION")
	fi

	echo "Selecting isolated Convex deployment $ref."
	if ! npx convex deployment create "$ref" --type dev --select "${expiration_args[@]}"; then
		echo "Deployment already exists or could not be created; trying to select it."
		npx convex deployment select "$ref"
	fi

	push_convex_env

	if npx convex deployment --help 2>/dev/null | grep -Eq '(^|[[:space:]])token([[:space:]]|$)'; then
		npx convex deployment token create agent-token --save-env || true
	fi

	npx convex dev --once
}

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
	usage
	exit 0
fi

if [ "${1:-}" = "--seed-env" ]; then
	seed_env
	exit 0
fi

if [ "${1:-}" != "" ]; then
	usage
	exit 2
fi

restore_env

if [ "${WORKTREE_SETUP_INSTALL:-1}" != "0" ]; then
	npm install
fi

setup_convex
