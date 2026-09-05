#!/usr/bin/env python3
"""Work-only-vs-Plan->Work-Bericht pro Kandidat aus results.jsonl.

Fuellt nur mechanisch bestimmbare Zeilen automatisch (Laufzeit, Tokenverbrauch,
Toolfehler, Planqualitaet, ungeplante Aenderungen). Funktionale Korrektheit,
Regressionen und Anforderungserfuellung sind laut Arbeitsauftrag KEINE
mechanischen Kriterien (Blind-Review/menschliches Urteil) und bleiben deshalb
ausdrueckliche TODO-Platzhalter statt einer erfundenen Zahl.

usage: report_plan_work.py --task <task-name> [--results-path <pfad>]
"""

from __future__ import annotations

import argparse
import json
import statistics
from collections import defaultdict
from pathlib import Path

DEFAULT_RESULTS = Path.home() / ".local" / "state" / "real-duel" / "obench-workspace" / "results.jsonl"

MANUAL = "TODO (manuell/Blind-Review)"
NA = "–"  # –


def _load_rows(results_path: Path, task: str) -> list[dict]:
    rows = []
    with open(results_path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            row = json.loads(line)
            if row.get("task") == task:
                rows.append(row)
    return rows


def _mean(values: list[float | None]) -> float | None:
    vals = [v for v in values if v is not None]
    return round(statistics.mean(vals), 3) if vals else None


def _tool_errors(row: dict) -> int | None:
    if row.get("workflow") == "work-only":
        t = row.get("telemetry") or {}
        return t.get("tool_errors")
    # plan-work: Summe aus Plan- und Work-Phase, falls beide Werte vorliegen.
    plan_t = row.get("plan_phase_telemetry") or {}
    work_t = row.get("work_phase_telemetry") or {}
    plan_errors = plan_t.get("tool_errors")
    work_errors = work_t.get("tool_errors")
    if plan_errors is None and work_errors is None:
        return None
    return (plan_errors or 0) + (work_errors or 0)


def _tokens(row: dict) -> int | None:
    if row.get("workflow") == "work-only":
        return row.get("tokens")
    plan_t = row.get("plan_phase_telemetry") or {}
    work_t = row.get("work_phase_telemetry") or {}
    # Pi: dicts mit "tokens"-Unterfeld; Codex: flache normalize()-Felder.
    total = 0
    found = False
    for phase in (plan_t, work_t):
        if not phase:
            continue
        if "tokens" in phase and isinstance(phase["tokens"], dict):
            t = phase["tokens"].get("total")
        else:
            fresh, out = phase.get("input_fresh"), phase.get("output")
            t = fresh + out if None not in (fresh, out) else None
        if t is not None:
            total += t
            found = True
    return total if found else None


def _plan_quality_cell(rows: list[dict]) -> str:
    qualities = []
    for row in rows:
        for gate in (row.get("gates") or {}).get("gates", []):
            if gate["name"] == "plan_quality_gate":
                qualities.append(gate["ok"])
    if not qualities:
        return NA
    return f"{sum(qualities)}/{len(qualities)} bestanden"


def _unplanned_changes_cell(rows: list[dict]) -> str:
    hits = []
    for row in rows:
        for gate in (row.get("gates") or {}).get("gates", []):
            if gate["name"] == "forbidden_surface_untouched" and not gate["ok"]:
                hits.append(row["run_id"])
    return "keine" if not hits else f"verletzt in: {', '.join(hits)}"


def build_table(harness: str, work_only_rows: list[dict], plan_work_rows: list[dict]) -> str:
    wall_wo = _mean([r.get("wall_time_s") for r in work_only_rows])
    wall_pw = _mean([r.get("wall_time_s") for r in plan_work_rows])
    tok_wo = _mean([_tokens(r) for r in work_only_rows])
    tok_pw = _mean([_tokens(r) for r in plan_work_rows])
    err_wo = _mean([_tool_errors(r) for r in work_only_rows])
    err_pw = _mean([_tool_errors(r) for r in plan_work_rows])

    def diff(a, b):
        return round(b - a, 3) if a is not None and b is not None else NA

    lines = [
        f"### {harness}",
        "",
        "| Kennzahl | Work-only | Plan→Work | Differenz |",
        "| --- | ---: | ---: | ---: |",
        f"| Funktional erfolgreich | {MANUAL} | {MANUAL} | {MANUAL} |",
        f"| Regressionen | {MANUAL} | {MANUAL} | {MANUAL} |",
        f"| Anforderungserfüllung | {MANUAL} | {MANUAL} | {MANUAL} |",
        f"| Laufzeit (s) | {wall_wo if wall_wo is not None else NA} "
        f"| {wall_pw if wall_pw is not None else NA} | {diff(wall_wo, wall_pw)} |",
        f"| Tokenverbrauch | {tok_wo if tok_wo is not None else NA} "
        f"| {tok_pw if tok_pw is not None else NA} | {diff(tok_wo, tok_pw)} |",
        f"| Toolfehler | {err_wo if err_wo is not None else NA} "
        f"| {err_pw if err_pw is not None else NA} | {diff(err_wo, err_pw)} |",
        f"| Nutzerkorrekturen | {MANUAL} | {MANUAL} | {MANUAL} |",
        f"| Planqualität | {NA} | {_plan_quality_cell(plan_work_rows)} | {NA} |",
        f"| Ungeplante Änderungen | {NA} | {_unplanned_changes_cell(plan_work_rows)} | {NA} |",
    ]
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--task", required=True)
    ap.add_argument("--results-path", type=Path, default=DEFAULT_RESULTS)
    args = ap.parse_args()

    if not args.results_path.exists():
        print(f"keine results.jsonl unter {args.results_path}")
        return 2

    rows = _load_rows(args.results_path, args.task)
    if not rows:
        print(f"keine Zeilen fuer Task {args.task!r} in {args.results_path}")
        return 1

    by_harness = defaultdict(lambda: {"work-only": [], "plan-work": []})
    for row in rows:
        by_harness[row["harness"]][row.get("workflow", "work-only")].append(row)

    print(f"# Work-only vs. Plan→Work: {args.task}\n")
    for harness in sorted(by_harness):
        wo = by_harness[harness]["work-only"]
        pw = by_harness[harness]["plan-work"]
        if not wo and not pw:
            continue
        print(build_table(harness, wo, pw))
        print()

    print(
        "Hinweis: 'Funktional erfolgreich', 'Regressionen', "
        "'Anforderungserfüllung' und 'Nutzerkorrekturen' sind laut "
        "Arbeitsauftrag keine mechanischen Kriterien und muessen durch "
        "Blind-Review/menschliches Urteil ausgefuellt werden."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
