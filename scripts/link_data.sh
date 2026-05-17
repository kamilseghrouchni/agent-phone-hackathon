#!/usr/bin/env bash
# Create symlinks from data/specimens.db and data/enriched/views.db to the
# real DB files defined in .data-paths.local.
#
# Usage:  bash scripts/link_data.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CFG="$ROOT/.data-paths.local"

if [ ! -f "$CFG" ]; then
  echo "✗ Missing $CFG"
  echo "  Copy .data-paths.local.example to .data-paths.local and edit the paths." >&2
  exit 1
fi

# shellcheck disable=SC1090
source "$CFG"

link() {
  local target="$1"
  local linkpath="$2"
  if [ -z "${target:-}" ]; then
    echo "✗ $linkpath: no target set in .data-paths.local" >&2
    exit 1
  fi
  if [ ! -e "$target" ]; then
    echo "✗ $linkpath: target does not exist → $target" >&2
    exit 1
  fi
  mkdir -p "$(dirname "$linkpath")"
  if [ -e "$linkpath" ] || [ -L "$linkpath" ]; then
    rm -f "$linkpath"
  fi
  ln -s "$target" "$linkpath"
  echo "✓ $linkpath → $target"
}

link "${SPECIMENS_DB:-}" "$ROOT/data/specimens.db"
link "${VIEWS_DB:-}"     "$ROOT/data/enriched/views.db"

echo ""
echo "Done. Verify with:  ls -la data/specimens.db data/enriched/views.db"
