#!/usr/bin/env bash
# Führt `npm run verify` (typecheck + test) in einem Benchmark-Worktree aus
# und erfasst Exit-Code und Dauer. Setzt PI_CODING_AGENT_DIR auf den
# Worktree-Pfad, damit Pi's eigenes `getAgentDir()` (genutzt vom
# allowlisteten `verify`-Tool und von thinking-view-config.ts) auf den
# Worktree statt auf den echten ~/.pi/agent zeigt — ohne das ist ein Test in
# tests/run.mjs ("verify runs the setup's fixed command from the agent
# directory") in jedem Worktree-Lauf fälschlich rot.
#
# Nutzung:
#   harness/run-verify.sh <worktree-pfad>
#
# Schreibt ein JSON-Objekt {"exitCode": N, "durationMs": N} auf stdout.
set -uo pipefail

WORKTREE_PATH="${1:?Worktree-Pfad fehlt}"

if [ ! -d "$WORKTREE_PATH/npm" ]; then
  echo "Kein npm/-Verzeichnis unter $WORKTREE_PATH — reset-task.sh zuerst ausführen." >&2
  exit 1
fi

START_MS=$(($(date +%s%N) / 1000000))
PI_CODING_AGENT_DIR="$WORKTREE_PATH" npm --prefix "$WORKTREE_PATH/npm" run verify > "$WORKTREE_PATH/.verify-output.log" 2>&1
EXIT_CODE=$?
END_MS=$(($(date +%s%N) / 1000000))

printf '{"exitCode": %d, "durationMs": %d, "logFile": "%s"}\n' \
  "$EXIT_CODE" "$((END_MS - START_MS))" "$WORKTREE_PATH/.verify-output.log"

exit "$EXIT_CODE"
