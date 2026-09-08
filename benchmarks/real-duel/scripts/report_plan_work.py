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


def _dedup_by_run_id(rows: list[dict]) -> list[dict]:
    """Deduplizierung nach run_id (letzter Eintrag gewinnt, entspricht der
    natuerlichen Append-Reihenfolge in results.jsonl). Ohne dies fliesst ein
    versehentlich zweimal geschriebener Lauf (gleiche run_id) unbemerkt
    doppelt gewichtet in die Aggregation ein (P2, Mehrfach-Trial-Support)."""
    by_run_id: dict[object, dict] = {}
    for row in rows:
        by_run_id[row.get("run_id") or id(row)] = row
    return list(by_run_id.values())


def _stats(values: list[float | None]) -> dict:
    """n/mean/median/min/max ueber die nicht-None-Werte (P2, Mehrfach-Trial-
    Aggregation). n=0: alle Felder None. n=1: min=max=mean=median=
    Einzelwert. Reine Zahlen, keine Interpretation -- "signifikant" o.ae.
    bleibt Text (siehe build_table), nie eine errechnete Zahl."""
    vals = [v for v in values if v is not None]
    if not vals:
        return {"n": 0, "mean": None, "median": None, "min": None, "max": None}
    return {
        "n": len(vals),
        "mean": round(statistics.mean(vals), 3),
        "median": round(statistics.median(vals), 3),
        "min": round(min(vals), 3),
        "max": round(max(vals), 3),
    }


def _format_stat_cell(stats: dict) -> str:
    """Bei n<=1 byte-identisch zum bisherigen Ein-Zahl-Format (Abwaerts-
    kompatibilitaet mit bestehenden Stufe-1-Fixtures/Tests). Bei n>1 zeigt
    die Zelle zusaetzlich n, Median und Min-Max-Spanne."""
    if stats["n"] == 0:
        return NA
    if stats["n"] == 1:
        return str(stats["mean"])
    return f"{stats['mean']} (n={stats['n']}, Median {stats['median']}, {stats['min']}–{stats['max']})"


def _metric_cell(rows: list[dict], extractor) -> tuple[dict, str]:
    stats = _stats([extractor(r) for r in rows])
    return stats, _format_stat_cell(stats)


def _mean(values: list[float | None]) -> float | None:
    return _stats(values)["mean"]


def _phase_tool_errors(row: dict, phase: str) -> int | None:
    """Toolfehler einer Phase (P1): bevorzugt aus den neuen
    `plan_phase_tool_trace`/`work_phase_tool_trace`-Summaries, Fallback auf
    die alten Phasen-Telemetrie-Felder. None, wenn fuer diese Phase keine
    Tooltrace-Daten vorliegen (Work-only hat keine Planphase)."""
    if row.get("workflow") == "work-only":
        if phase == "total":
            t = row.get("telemetry") or {}
            return t.get("tool_errors")
        return None  # work-only kennt keine Plan-/Work-Phasen
    if phase == "plan":
        trace = row.get("plan_phase_tool_trace") or {}
        if isinstance(trace, dict) and trace.get("tool_errors") is not None:
            return trace.get("tool_errors")
        return (row.get("plan_phase_telemetry") or {}).get("tool_errors")
    if phase == "work":
        trace = row.get("work_phase_tool_trace") or {}
        if isinstance(trace, dict) and trace.get("tool_errors") is not None:
            return trace.get("tool_errors")
        return (row.get("work_phase_telemetry") or {}).get("tool_errors")
    # total: bevorzugt aggregierten Gesamt-Tooltrace, sonst Phasensumme.
    total = row.get("tool_trace_summary") or {}
    if isinstance(total, dict) and total.get("tool_errors") is not None:
        return total.get("tool_errors")
    plan_errors = _phase_tool_errors(row, "plan")
    work_errors = _phase_tool_errors(row, "work")
    if plan_errors is None and work_errors is None:
        return None
    return (plan_errors or 0) + (work_errors or 0)


def _tool_errors(row: dict) -> int | None:
    """Gesamt-Toolfehler einer Zeile (abwaertskompatibel). Bevorzugt den
    aggregierten Pi-Plan->Work-Tooltrace (P1), sonst die alte Phasen-
    Telemetrie-Summe."""
    return _phase_tool_errors(row, "total")


TOKEN_FIELDS = (
    "input_fresh",
    "input_cache_read",
    "input_cache_write",
    "output",
)

# Pi's plan/work phases predate the normalized telemetry schema and retain
# their usage under `tokens`; work-only Pi rows and all Codex rows use the
# normalized flat names.  Keep that compatibility at this one boundary so the
# report always compares the same component on both sides.
_NESTED_TOKEN_FIELDS = {
    "input_fresh": "input",
    "input_cache_read": "cacheRead",
    "input_cache_write": "cacheWrite",
    "output": "output",
}


def _phase_metric(phase: dict, field: str) -> int | None:
    nested = phase.get("tokens")
    if isinstance(nested, dict):
        return nested.get(_NESTED_TOKEN_FIELDS[field])
    return phase.get(field)


def _token_metric(row: dict, field: str) -> int | None:
    if row.get("workflow") == "work-only":
        return _phase_metric(row.get("telemetry") or {}, field)

    total = 0
    found = False
    for phase in (
        row.get("plan_phase_telemetry") or {},
        row.get("work_phase_telemetry") or {},
    ):
        value = _phase_metric(phase, field)
        if value is not None:
            total += value
            found = True
    return total if found else None


def _processed_tokens(row: dict) -> int | None:
    values = [_token_metric(row, field) for field in TOKEN_FIELDS]
    return sum(values) if all(value is not None for value in values) else None


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
    wall_wo_stats, wall_wo_cell = _metric_cell(work_only_rows, lambda r: r.get("wall_time_s"))
    wall_pw_stats, wall_pw_cell = _metric_cell(plan_work_rows, lambda r: r.get("wall_time_s"))
    token_cells = {
        field: (
            _metric_cell(work_only_rows, lambda r, f=field: _token_metric(r, f)),
            _metric_cell(plan_work_rows, lambda r, f=field: _token_metric(r, f)),
        )
        for field in TOKEN_FIELDS
    }
    processed_wo_stats, processed_wo_cell = _metric_cell(work_only_rows, _processed_tokens)
    processed_pw_stats, processed_pw_cell = _metric_cell(plan_work_rows, _processed_tokens)
    err_wo_stats, err_wo_cell = _metric_cell(work_only_rows, _tool_errors)
    err_pw_stats, err_pw_cell = _metric_cell(plan_work_rows, _tool_errors)
    # P1: getrennte Plan-/Work-Toolfehler (nur Plan->Work hat Phasen).
    plan_err_wo_stats, plan_err_wo_cell = _metric_cell(work_only_rows, lambda r: _phase_tool_errors(r, "plan"))
    plan_err_pw_stats, plan_err_pw_cell = _metric_cell(plan_work_rows, lambda r: _phase_tool_errors(r, "plan"))
    work_err_wo_stats, work_err_wo_cell = _metric_cell(work_only_rows, lambda r: _phase_tool_errors(r, "work"))
    work_err_pw_stats, work_err_pw_cell = _metric_cell(plan_work_rows, lambda r: _phase_tool_errors(r, "work"))

    def diff(a_stats, b_stats):
        a, b = a_stats["mean"], b_stats["mean"]
        return round(b - a, 3) if a is not None and b is not None else NA

    lines = [
        f"### {harness}",
        "",
        "| Kennzahl | Work-only | Plan→Work | Differenz |",
        "| --- | ---: | ---: | ---: |",
        f"| Funktional erfolgreich | {MANUAL} | {MANUAL} | {MANUAL} |",
        f"| Regressionen | {MANUAL} | {MANUAL} | {MANUAL} |",
        f"| Anforderungserfüllung | {MANUAL} | {MANUAL} | {MANUAL} |",
        f"| Laufzeit (s) | {wall_wo_cell} | {wall_pw_cell} | {diff(wall_wo_stats, wall_pw_stats)} |",
        f"| Fresh Input | {token_cells['input_fresh'][0][1]} "
        f"| {token_cells['input_fresh'][1][1]} | {diff(token_cells['input_fresh'][0][0], token_cells['input_fresh'][1][0])} |",
        f"| Cache Read | {token_cells['input_cache_read'][0][1]} "
        f"| {token_cells['input_cache_read'][1][1]} | {diff(token_cells['input_cache_read'][0][0], token_cells['input_cache_read'][1][0])} |",
        f"| Cache Write | {token_cells['input_cache_write'][0][1]} "
        f"| {token_cells['input_cache_write'][1][1]} | {diff(token_cells['input_cache_write'][0][0], token_cells['input_cache_write'][1][0])} |",
        f"| Output | {token_cells['output'][0][1]} "
        f"| {token_cells['output'][1][1]} | {diff(token_cells['output'][0][0], token_cells['output'][1][0])} |",
        f"| Verarbeitete Tokens (Summe obiger Werte) | {processed_wo_cell} "
        f"| {processed_pw_cell} | {diff(processed_wo_stats, processed_pw_stats)} |",
        f"| Toolfehler (gesamt) | {err_wo_cell} "
        f"| {err_pw_cell} | {diff(err_wo_stats, err_pw_stats)} |",
        f"| Toolfehler Planphase | {plan_err_wo_cell} "
        f"| {plan_err_pw_cell} | {diff(plan_err_wo_stats, plan_err_pw_stats)} |",
        f"| Toolfehler Workphase | {work_err_wo_cell} "
        f"| {work_err_pw_cell} | {diff(work_err_wo_stats, work_err_pw_stats)} |",
        f"| Nutzerkorrekturen | {MANUAL} | {MANUAL} | {MANUAL} |",
        f"| Planqualität | {NA} | {_plan_quality_cell(plan_work_rows)} | {NA} |",
        f"| Ungeplante Änderungen | {NA} | {_unplanned_changes_cell(plan_work_rows)} | {NA} |",
        f"| Streuung/Muster (n>1, qualitativ) | {MANUAL} | {MANUAL} | {MANUAL} |",
    ]
    return "\n".join(lines)


def build_combined_table(work_only_rows_by_harness: dict, plan_work_rows_by_harness: dict) -> str:
    """P0: Kombinierte Vier-Spalten-Tabelle (Codex WO | Codex PW | Pi WO | Pi PW)
    direkt aus results.jsonl, damit die section-5-Smoke-Tabelle nicht mehr
    manuell gepflegt werden kann, ohne dass eine Abweichung auffaellt.
    ``*_rows_by_harness``: {harness -> list[row]} (bereits pro Task gefiltert).
    """
    harnesses = sorted(set(work_only_rows_by_harness) | set(plan_work_rows_by_harness))
    if not harnesses:
        return ""  # noqa: RET201
    # Stabile Reihenfolge: Codex first, dann Pi -- wie im Pilotenbericht.
    order = [h for h in ("codex-real", "pi-real") if h in harnesses] + [
        h for h in harnesses if h not in ("codex-real", "pi-real")
    ]
    wo = {h: _mean([r.get("wall_time_s") for r in work_only_rows_by_harness.get(h, [])]) for h in order}
    pw = {h: _mean([r.get("wall_time_s") for r in plan_work_rows_by_harness.get(h, [])]) for h in order}
    tok_fresh = {
        h: (
            _mean([_token_metric(r, "input_fresh") for r in work_only_rows_by_harness.get(h, [])]),
            _mean([_token_metric(r, "input_fresh") for r in plan_work_rows_by_harness.get(h, [])]),
        )
        for h in order
    }
    tok_cache = {
        h: (
            _mean([_token_metric(r, "input_cache_read") for r in work_only_rows_by_harness.get(h, [])]),
            _mean([_token_metric(r, "input_cache_read") for r in plan_work_rows_by_harness.get(h, [])]),
        )
        for h in order
    }
    tok_out = {
        h: (
            _mean([_token_metric(r, "output") for r in work_only_rows_by_harness.get(h, [])]),
            _mean([_token_metric(r, "output") for r in plan_work_rows_by_harness.get(h, [])]),
        )
        for h in order
    }
    err = {
        h: (
            _mean([_tool_errors(r) for r in work_only_rows_by_harness.get(h, [])]),
            _mean([_tool_errors(r) for r in plan_work_rows_by_harness.get(h, [])]),
        )
        for h in order
    }

    def cell(value):
        return NA if value is None else value

    def delta(a, b):
        return NA if a is None or b is None else round(b - a, 3)

    # Header: 6 Spalten pro Harness: WO, PW, Δ(WO->PW) jeweils fuer Laufzeit.
    # Wir bauen eine kompakte Tabelle mit einer Spalte pro Kennzahl und vier
    # Wertspalten (Codex WO, Codex PW, Pi WO, Pi PW) plus zwei Δ-Spalten.
    h_c = order[0] if "codex-real" in order else order[0]
    h_p = "pi-real" if "pi-real" in order else (order[1] if len(order) > 1 else order[0])
    lines = [
        "",
        "| Kennzahl | Codex Work-only | Codex Plan→Work | Δ | Pi Work-only | Pi Plan→Work | Δ |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
        f"| Laufzeit (s) | {cell(wo.get(h_c))} | {cell(pw.get(h_c))} | {delta(wo.get(h_c), pw.get(h_c))} "
        f"| {cell(wo.get(h_p))} | {cell(pw.get(h_p))} | {delta(wo.get(h_p), pw.get(h_p))} |",
        f"| Fresh Input | {cell(tok_fresh[h_c][0])} | {cell(tok_fresh[h_c][1])} | {delta(*tok_fresh[h_c])} "
        f"| {cell(tok_fresh[h_p][0])} | {cell(tok_fresh[h_p][1])} | {delta(*tok_fresh[h_p])} |",
        f"| Cache Read | {cell(tok_cache[h_c][0])} | {cell(tok_cache[h_c][1])} | {delta(*tok_cache[h_c])} "
        f"| {cell(tok_cache[h_p][0])} | {cell(tok_cache[h_p][1])} | {delta(*tok_cache[h_p])} |",
        f"| Output | {cell(tok_out[h_c][0])} | {cell(tok_out[h_c][1])} | {delta(*tok_out[h_c])} "
        f"| {cell(tok_out[h_p][0])} | {cell(tok_out[h_p][1])} | {delta(*tok_out[h_p])} |",
        f"| Toolfehler | {cell(err[h_c][0])} | {cell(err[h_c][1])} | {delta(*err[h_c])} "
        f"| {cell(err[h_p][0])} | {cell(err[h_p][1])} | {delta(*err[h_p])} |",
        "",
        "Hinweis: reproduzierbar generiert von `report_plan_work.py --combined`; "
        "manuelle Werte in dieser Tabelle wuerden sofort als Abweichung von "
        "results.jsonl auffallen.",
    ]
    return "\n".join(lines)


def _render_task_report(task: str, rows: list[dict], combined: bool) -> int:
    if not rows:
        print(f"keine Zeilen fuer Task {task!r}")
        return 1

    by_harness = defaultdict(lambda: {"work-only": [], "plan-work": []})
    for row in rows:
        by_harness[row["harness"]][row.get("workflow", "work-only")].append(row)

    print(f"# Work-only vs. Plan→Work: {task}\n")
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
    if combined:
        wo_by = {h: r["work-only"] for h, r in by_harness.items()}
        pw_by = {h: r["plan-work"] for h, r in by_harness.items()}
        print(build_combined_table(wo_by, pw_by))
    return 0


def _parse_all_tasks_spec(specs: list[str]) -> list[tuple[str, str]]:
    """``["task:klasse", ...]`` -> ``[(task, klasse), ...]``. Reihenfolge wie
    angegeben bleibt erhalten (Task-Reihenfolge im Bericht ist nicht
    alphabetisch, sondern folgt der vom Aufrufer gewaehlten Klassenordnung
    A/B/C)."""
    parsed = []
    for spec in specs:
        if ":" not in spec:
            raise ValueError(f"--all-tasks erwartet 'task:klasse', erhalten: {spec!r}")
        task, klasse = spec.split(":", 1)
        parsed.append((task, klasse))
    return parsed


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--task", help="Einzelner Task-Bericht (wie bisher).")
    ap.add_argument(
        "--all-tasks", nargs="+", metavar="TASK:KLASSE",
        help="Mehrere Tasks mit Komplexitaetsklasse fuer einen Gesamtbericht, "
             "z.B. --all-tasks real-03-lsp-ruby-profile:A "
             "real-04-session-health-provider-filter:B "
             "real-05-lsp-rename-tool:C. Druckt pro Task die normale Tabelle "
             "UND am Ende eine nach Klasse getrennte Uebersicht -- Klassen "
             "werden NICHT gemeinsam gemittelt (ein komplexer Task soll "
             "nicht durch zwei kleine Tasks mathematisch unsichtbar werden).",
    )
    ap.add_argument("--results-path", type=Path, default=DEFAULT_RESULTS)
    ap.add_argument("--combined", action="store_true",
                   help="Zusaetzlich eine kombinierte Vier-Spalten-Tabelle "
                        "(Codex WO | Codex PW | Pi WO | Pi PW) direkt aus "
                        "results.jsonl ausgeben (reproduzierbar, kein manuelles "
                        "Pflegen der Smoke-Werte).")
    args = ap.parse_args()

    if bool(args.task) == bool(args.all_tasks):
        print("genau eines von --task oder --all-tasks angeben")
        return 2

    if not args.results_path.exists():
        print(f"keine results.jsonl unter {args.results_path}")
        return 2

    if args.task:
        rows = _dedup_by_run_id(_load_rows(args.results_path, args.task))
        return _render_task_report(args.task, rows, args.combined)

    try:
        task_classes = _parse_all_tasks_spec(args.all_tasks)
    except ValueError as exc:
        print(str(exc))
        return 2

    exit_code = 0
    by_class: dict[str, list[str]] = defaultdict(list)
    for task, klasse in task_classes:
        rows = _dedup_by_run_id(_load_rows(args.results_path, task))
        exit_code = _render_task_report(task, rows, args.combined) or exit_code
        by_class[klasse].append(task)
        print()

    print("# Gesamtuebersicht nach Komplexitaetsklasse\n")
    print(
        "Klassen werden getrennt ausgewiesen, nicht gemeinsam gemittelt -- "
        "siehe Einzeltabellen oben fuer Zahlen je Task/Harness/Workflow."
    )
    for klasse in sorted(by_class):
        print(f"- Klasse {klasse}: {', '.join(by_class[klasse])}")
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
