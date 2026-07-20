#!/usr/bin/env bash
# Setzt eine Benchmark-Aufgabe auf einen reproduzierbaren Ausgangszustand
# zurück: legt einen isolierten Git-Worktree am Referenzcommit an und kopiert
# ggf. das Fixture-Verzeichnis der Aufgabe hinein. Der Haupt-Checkout bleibt
# unberührt.
#
# Nutzung:
#   harness/reset-task.sh <task-id> [worktree-basisverzeichnis]
#
# Beispiel:
#   harness/reset-task.sh 02-local-bug
#   harness/reset-task.sh 02-local-bug /tmp/pi-benchmark
#
# Gibt den Pfad des angelegten Worktrees auf stdout aus.
set -euo pipefail

TASK_ID="${1:?Aufgaben-ID fehlt, z. B. 02-local-bug}"
WORKTREE_BASE="${2:-/tmp/pi-benchmark}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REFERENCE_COMMIT="7b886a39d3f9d639b83066628772f58967089149"
TASK_DIR="$REPO_ROOT/benchmarks/tasks/$TASK_ID"

if [ ! -d "$TASK_DIR" ]; then
  echo "Unbekannte Aufgabe: $TASK_ID (kein Verzeichnis unter benchmarks/tasks/)" >&2
  exit 1
fi

WORKTREE_PATH="$WORKTREE_BASE/$TASK_ID"

if [ -d "$WORKTREE_PATH" ]; then
  echo "Entferne vorhandenen Worktree unter $WORKTREE_PATH" >&2
  git -C "$REPO_ROOT" worktree remove --force "$WORKTREE_PATH" 2>/dev/null || rm -rf "$WORKTREE_PATH"
fi

mkdir -p "$WORKTREE_BASE"
git -C "$REPO_ROOT" worktree add --detach "$WORKTREE_PATH" "$REFERENCE_COMMIT" >&2

# npm/node_modules ist gitignored (siehe npm/.gitignore) und daher in einem
# frischen Worktree nicht vorhanden. Symlink statt npm ci: ein voller Install
# pro Reset wäre für einen Benchmark-Lauf unnötig teuer, und der Haupt-
# Checkout hat die exakt passenden Versionen aus package-lock.json bereits.
if [ -d "$REPO_ROOT/npm/node_modules" ]; then
  ln -s "$REPO_ROOT/npm/node_modules" "$WORKTREE_PATH/npm/node_modules"
else
  echo "Warnung: $REPO_ROOT/npm/node_modules fehlt — vorher 'npm ci --prefix npm' im Haupt-Checkout ausführen." >&2
fi

# Fixture-Overlay: Aufgaben, deren betroffene Datei(en) beim Referenzcommit
# nicht existieren (z. B. extensions/diff-viewer/ wurde erst danach
# hinzugefügt, siehe TASK.md der jeweiligen Aufgabe), liefern einen
# eigenständigen Snapshot unter tasks/<id>/fixture/. Der wird zusätzlich in
# den Worktree kopiert, überschreibt aber nichts, was aus dem Referenzcommit
# selbst stammt.
if [ -d "$TASK_DIR/fixture" ]; then
  cp -r "$TASK_DIR/fixture/." "$WORKTREE_PATH/benchmark-fixture/"
  echo "Fixture-Overlay kopiert nach $WORKTREE_PATH/benchmark-fixture/" >&2
fi

echo "$WORKTREE_PATH"
