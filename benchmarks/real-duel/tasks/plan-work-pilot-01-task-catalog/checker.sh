#!/usr/bin/env bash
# Prueft benchmarks/real-duel/scripts/list_tasks.py gegen den in instruction.md
# festgelegten Kontrakt (Default-Modus laeuft fehlerfrei, --json liefert
# valides JSON mit dem vorgegebenen Schema, deckt die zum Zeitpunkt der
# Aufgabenerstellung bekannten Tasks korrekt ab, alphabetisch sortiert).
set -euo pipefail

SCRIPT="benchmarks/real-duel/scripts/list_tasks.py"

if [ ! -f "$SCRIPT" ]; then
  echo "FAIL: $SCRIPT wurde nicht angelegt"
  exit 1
fi

TMP_HUMAN_OUT=$(mktemp)
TMP_HUMAN_ERR=$(mktemp)
TMP_JSON_OUT=$(mktemp)
TMP_JSON_ERR=$(mktemp)
trap 'rm -f "$TMP_HUMAN_OUT" "$TMP_HUMAN_ERR" "$TMP_JSON_OUT" "$TMP_JSON_ERR"' EXIT

if ! python3 "$SCRIPT" >"$TMP_HUMAN_OUT" 2>"$TMP_HUMAN_ERR"; then
  echo "FAIL: $SCRIPT ohne --json ist fehlgeschlagen:"
  cat "$TMP_HUMAN_ERR"
  exit 1
fi

if ! python3 "$SCRIPT" --json >"$TMP_JSON_OUT" 2>"$TMP_JSON_ERR"; then
  echo "FAIL: $SCRIPT --json ist fehlgeschlagen:"
  cat "$TMP_JSON_ERR"
  exit 1
fi

python3 - "$TMP_JSON_OUT" <<'PYEOF'
import json
import sys

json_path = sys.argv[1]
with open(json_path, encoding="utf-8") as fh:
    try:
        data = json.load(fh)
    except json.JSONDecodeError as exc:
        print(f"FAIL: --json liefert kein valides JSON: {exc}")
        sys.exit(1)

if not isinstance(data, list):
    print("FAIL: --json liefert kein JSON-Array auf oberster Ebene")
    sys.exit(1)

by_name = {}
for entry in data:
    if not isinstance(entry, dict):
        print(f"FAIL: Eintrag ist kein Objekt: {entry!r}")
        sys.exit(1)
    missing = {"name", "has_checker", "workflows"} - entry.keys()
    if missing:
        print(f"FAIL: Eintrag {entry!r} fehlen Schluessel {missing}")
        sys.exit(1)
    if not isinstance(entry["name"], str):
        print(f"FAIL: 'name' ist kein String: {entry!r}")
        sys.exit(1)
    if not isinstance(entry["has_checker"], bool):
        print(f"FAIL: 'has_checker' ist kein Bool: {entry!r}")
        sys.exit(1)
    workflows = entry["workflows"]
    if not isinstance(workflows, list) or not all(isinstance(w, str) for w in workflows):
        print(f"FAIL: 'workflows' ist keine Liste von Strings: {entry!r}")
        sys.exit(1)
    by_name[entry["name"]] = entry

names = [e["name"] for e in data]
if names != sorted(names):
    print(f"FAIL: nicht alphabetisch sortiert: {names}")
    sys.exit(1)

expected_known = {
    "smoke-01-marker-file": {"has_checker": True, "workflows_superset": {"work-only"}},
    "real-01-tui-warm-theme": {"has_checker": False, "workflows_superset": {"work-only"}},
    "real-02-gui-ux-redesign": {"has_checker": False, "workflows_superset": {"work-only"}},
}
for name, expectation in expected_known.items():
    if name not in by_name:
        print(f"FAIL: bekannter Task {name!r} fehlt in der Ausgabe")
        sys.exit(1)
    entry = by_name[name]
    if entry["has_checker"] != expectation["has_checker"]:
        print(
            f"FAIL: {name}: has_checker={entry['has_checker']!r}, "
            f"erwartet {expectation['has_checker']!r}"
        )
        sys.exit(1)
    if not expectation["workflows_superset"].issubset(set(entry["workflows"])):
        print(
            f"FAIL: {name}: workflows={entry['workflows']!r} deckt "
            f"{expectation['workflows_superset']!r} nicht ab"
        )
        sys.exit(1)

print("list_tasks.py: Schema und bekannte Tasks OK")
PYEOF

echo "SCORE:100"
exit 0
