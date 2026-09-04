#!/usr/bin/env bash
# Reines Plumbing: prueft nur, ob die Marker-Datei mit exaktem Inhalt existiert.
set -euo pipefail

if [ ! -f SMOKE_OK.txt ]; then
  echo "FAIL: SMOKE_OK.txt fehlt"
  exit 1
fi

content=$(cat SMOKE_OK.txt)
if [ "$content" != "real-duel-smoke-ok" ]; then
  echo "FAIL: falscher Inhalt in SMOKE_OK.txt: '$content'"
  exit 1
fi

echo "SCORE:100"
exit 0
