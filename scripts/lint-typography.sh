#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

RAW_UTILITY_PATTERN='\btext-(xs|sm|base|lg|xl|2xl|3xl)\b|\bfont-(medium|semibold|bold|normal)\b|\bleading-(none|snug|tight|relaxed|normal)\b|\btracking-(tight|wide|wider|widest)\b'
LEGACY_TYPE_PATTERN='(?<!text-)type-(h1|h2|h3|h4|lead|body|body-sm|caption|label|control)\b'

if rg -n --glob '*.svelte' "$RAW_UTILITY_PATTERN" src/lib/components; then
	echo "Typography lint failed: use semantic text-type-* classes in src/lib/components." >&2
	exit 1
fi

if rg -n -P --glob '*.svelte' "$LEGACY_TYPE_PATTERN" src/lib/components; then
	echo "Typography lint failed: use semantic text-type-* classes in src/lib/components." >&2
	exit 1
fi

echo "Typography lint passed."
