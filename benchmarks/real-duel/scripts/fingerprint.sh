#!/usr/bin/env bash
# Erfasst Base-SHA, Dirty-State und Tool-Versionen vor einem real-duel-Lauf.
# Ausgabe: JSON auf stdout.
set -euo pipefail

REPO="${REAL_DUEL_REPO:-/home/d/.pi/agent}"
cd "$REPO"

dirty=$(git status --porcelain | wc -l | tr -d ' ')
base_sha=$(git rev-parse HEAD)
pi_version=$(pi --version 2>&1 || echo "unavailable")
codex_version=$(codex --version 2>&1 || echo "unavailable")
captured_at=$(date -Iseconds)

cat <<EOF
{
  "base_sha": "$base_sha",
  "dirty_files": $dirty,
  "pi_version": "$pi_version",
  "codex_version": "$codex_version",
  "pi_model": "gpt-5.6-terra",
  "codex_model": "gpt-5.6-terra",
  "captured_at": "$captured_at"
}
EOF

if [ "$dirty" -ne 0 ]; then
  echo "WARN: $REPO ist nicht sauber (main hat uncommitted changes) — Base-SHA-Vergleichbarkeit eingeschraenkt" >&2
fi
