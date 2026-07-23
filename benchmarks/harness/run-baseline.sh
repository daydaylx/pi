#!/usr/bin/env bash
# Verkettet die manuellen RUNBOOK.md-Schritte 1 (Reset), 3 (Verify) und 4
# (Metriken sammeln) für einen einzelnen Baseline-Lauf (Auftrag 2, siehe
# docs/auftraege/arbeitsauftraege.md). Schritt 2 (den Agenten im Worktree
# arbeiten lassen) und Schritt 5 (manualAssessment ausfüllen) bleiben
# bewusst manuell/interaktiv — siehe SCORING.md, "Automatisch vs.
# subjektiv".
#
# Nutzung:
#   harness/run-baseline.sh prepare <task-id> [worktree-basisverzeichnis]
#   harness/run-baseline.sh finish  <task-id> [worktree-basisverzeichnis] \
#     [--allowed-files "a,b,c"] [--session <pfad> ...]
#
# Ablauf:
#   1. prepare <task-id>   -> setzt Worktree zurück, merkt sich Startzeit
#   2. Pi im ausgegebenen Worktree-Pfad starten, TASK.md-Auftragstext
#      übergeben, Sitzung bis zum Ende laufen lassen
#   3. finish <task-id>    -> führt Verify aus, sucht die Session-Datei,
#      ruft collect-metrics.mjs auf, schreibt benchmarks/results/<...>.json
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HARNESS_DIR="$REPO_ROOT/benchmarks/harness"

# Aufgaben mit eigenständigem Fixture-Test statt npm run verify (siehe
# jeweilige TASK.md, Abschnitt "Relevante Tests").
FIXTURE_TEST_TASKS=(02-local-bug 03-failing-unit-test 05-refactor-no-behavior-change)
# Aufgaben ohne automatisiert prüfbaren Test (reine Analyse-/
# Verhaltensbeobachtungsaufgaben).
NO_TEST_TASKS=(06-unfamiliar-code-navigation 09-hanging-tool-call)

usage() {
  echo "Nutzung:" >&2
  echo "  $0 prepare <task-id> [worktree-basisverzeichnis]" >&2
  echo "  $0 finish  <task-id> [worktree-basisverzeichnis] [--allowed-files \"a,b,c\"] [--session <pfad> ...]" >&2
  exit 1
}

contains() {
  local needle="$1"
  shift
  for item in "$@"; do
    [ "$item" = "$needle" ] && return 0
  done
  return 1
}

# Repliziert getDefaultSessionDirPath() aus
# @earendil-works/pi-coding-agent/dist/core/session-manager.js:
#   `--${cwd ohne führenden Slash, "/","\",":" -> "-"}--`
cwd_to_session_slug() {
  local cwd="$1"
  local stripped="${cwd#/}"
  local safe="${stripped//\//-}"
  safe="${safe//\\/-}"
  safe="${safe//:/-}"
  echo "--${safe}--"
}

resolve_agent_dir() {
  if [ -n "${PI_CODING_AGENT_DIR:-}" ]; then
    echo "$PI_CODING_AGENT_DIR"
  else
    echo "$HOME/.pi/agent"
  fi
}

cmd_prepare() {
  local task_id="${1:?Aufgaben-ID fehlt}"
  local worktree_base="${2:-/tmp/pi-benchmark}"

  local worktree_path
  worktree_path="$("$HARNESS_DIR/reset-task.sh" "$task_id" "$worktree_base")"

  local window_start
  window_start="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  printf '{"taskId": "%s", "windowStart": "%s"}\n' "$task_id" "$window_start" \
    > "$worktree_path/.baseline-meta.json"

  echo "Worktree bereit: $worktree_path" >&2
  echo "Fensterstart notiert: $window_start" >&2
  echo "" >&2
  echo "Nächster Schritt: Pi in diesem Worktree starten und den Auftragstext" >&2
  echo "aus benchmarks/tasks/$task_id/TASK.md (Abschnitt \"Auftrag\") übergeben." >&2
  echo "Nach Abschluss der Sitzung:" >&2
  echo "  $0 finish $task_id $worktree_base" >&2
  echo "$worktree_path"
}

run_verify_for_task() {
  local task_id="$1"
  local worktree_path="$2"
  local verify_result_path="$worktree_path/.verify-result.json"

  if contains "$task_id" "${NO_TEST_TASKS[@]}"; then
    echo "Aufgabe $task_id hat keinen automatisiert prüfbaren Test (siehe TASK.md) — Verify wird übersprungen." >&2
    echo ""
    return 0
  fi

  if contains "$task_id" "${FIXTURE_TEST_TASKS[@]}"; then
    local fixture_test="$worktree_path/benchmark-fixture/run-fixture-test.mjs"
    if [ ! -f "$fixture_test" ]; then
      echo "Fixture-Test $fixture_test nicht gefunden." >&2
      exit 1
    fi
    local log_file="$worktree_path/.verify-output.log"
    local start_ms end_ms exit_code
    start_ms=$(($(date +%s%N) / 1000000))
    node "$fixture_test" > "$log_file" 2>&1 && exit_code=0 || exit_code=$?
    end_ms=$(($(date +%s%N) / 1000000))
    printf '{"exitCode": %d, "durationMs": %d, "logFile": "%s"}\n' \
      "$exit_code" "$((end_ms - start_ms))" "$log_file" > "$verify_result_path"
    echo "Fixture-Test ausgeführt (exitCode=$exit_code)." >&2
    echo "$verify_result_path"
    return 0
  fi

  "$HARNESS_DIR/run-verify.sh" "$worktree_path" > "$verify_result_path" || true
  echo "npm run verify ausgeführt (Details in $worktree_path/.verify-output.log)." >&2
  echo "$verify_result_path"
}

find_session_files() {
  local worktree_path="$1"
  local window_start="$2"
  local agent_dir slug session_dir
  agent_dir="$(resolve_agent_dir)"
  slug="$(cwd_to_session_slug "$worktree_path")"
  session_dir="$agent_dir/sessions/$slug"

  if [ ! -d "$session_dir" ]; then
    echo "Kein Session-Verzeichnis unter $session_dir gefunden." >&2
    return 1
  fi

  # Session-Dateien tragen den ISO-Zeitstempel im Dateinamen (siehe
  # RUNBOOK.md); alphabetische Sortierung entspricht daher chronologischer
  # Sortierung. Nur Dateien ab Fensterstart berücksichtigen.
  find "$session_dir" -maxdepth 1 -name '*.jsonl' -newermt "$window_start" \
    | sort
}

cmd_finish() {
  local task_id="${1:?Aufgaben-ID fehlt}"
  shift
  local worktree_base="/tmp/pi-benchmark"
  local allowed_files=""
  local explicit_sessions=()

  if [ $# -gt 0 ] && [[ "$1" != --* ]]; then
    worktree_base="$1"
    shift
  fi
  while [ $# -gt 0 ]; do
    case "$1" in
      --allowed-files) allowed_files="$2"; shift 2 ;;
      --session) explicit_sessions+=("$2"); shift 2 ;;
      *) echo "Unbekannte Option: $1" >&2; usage ;;
    esac
  done

  local worktree_path="$worktree_base/$task_id"
  local meta_file="$worktree_path/.baseline-meta.json"
  if [ ! -f "$meta_file" ]; then
    echo "Kein '$meta_file' gefunden — vorher '$0 prepare $task_id $worktree_base' ausführen." >&2
    exit 1
  fi
  local window_start
  window_start="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf-8')).windowStart)" "$meta_file")"
  local window_end
  window_end="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"

  local verify_result_path
  verify_result_path="$(run_verify_for_task "$task_id" "$worktree_path")"

  local session_args=()
  if [ ${#explicit_sessions[@]} -gt 0 ]; then
    for s in "${explicit_sessions[@]}"; do
      session_args+=(--session "$s")
    done
  else
    local sessions
    sessions="$(find_session_files "$worktree_path" "$window_start" || true)"
    if [ -z "$sessions" ]; then
      echo "Keine Session-Datei ab Fensterstart ($window_start) gefunden." >&2
      echo "Mit --session <pfad> explizit angeben." >&2
      exit 1
    fi
    local count
    count="$(echo "$sessions" | wc -l)"
    if [ "$count" -gt 1 ]; then
      echo "Warnung: $count Session-Dateien im Fenster gefunden, verwende alle:" >&2
      echo "$sessions" | sed 's/^/  /' >&2
    fi
    while IFS= read -r s; do
      session_args+=(--session "$s")
    done <<< "$sessions"
  fi

  local run_history_arg=()
  if [ -f "$REPO_ROOT/run-history.jsonl" ]; then
    run_history_arg=(--run-history "$REPO_ROOT/run-history.jsonl")
  fi

  local verify_arg=()
  if [ -n "$verify_result_path" ] && [ -f "$verify_result_path" ]; then
    verify_arg=(--verify-result "$verify_result_path")
  fi

  local allowed_files_arg=()
  if [ -n "$allowed_files" ]; then
    allowed_files_arg=(--allowed-files "$allowed_files")
  fi

  mkdir -p "$REPO_ROOT/benchmarks/results"
  local out_file="$REPO_ROOT/benchmarks/results/${task_id}-$(date -u +%Y%m%d-%H%M).json"

  node "$HARNESS_DIR/collect-metrics.mjs" \
    --task "$task_id" \
    --worktree "$worktree_path" \
    "${session_args[@]}" \
    "${run_history_arg[@]}" \
    "${verify_arg[@]}" \
    --window-start "$window_start" --window-end "$window_end" \
    "${allowed_files_arg[@]}" \
    > "$out_file"

  echo "Ergebnis geschrieben nach $out_file" >&2
  echo "manualAssessment.* sind null — vor Auswertung von Hand gegen TASK.md ausfüllen." >&2
  echo "Aufräumen nicht vergessen: git worktree remove --force $worktree_path" >&2
  echo "$out_file"
}

case "${1:-}" in
  prepare) shift; cmd_prepare "$@" ;;
  finish) shift; cmd_finish "$@" ;;
  *) usage ;;
esac
