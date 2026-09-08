#!/usr/bin/env python3
"""Regression tests for plan/work telemetry aggregation."""

from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("report_plan_work.py")
spec = importlib.util.spec_from_file_location("report_plan_work", SCRIPT)
report = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(report)


class TokenMetricTest(unittest.TestCase):
    def test_work_only_uses_normalized_components(self) -> None:
        row = {
            "workflow": "work-only",
            "telemetry": {
                "input_fresh": 10,
                "input_cache_read": 20,
                "input_cache_write": 1,
                "output": 3,
            },
        }

        self.assertEqual(report._token_metric(row, "input_fresh"), 10)
        self.assertEqual(report._token_metric(row, "input_cache_read"), 20)
        self.assertEqual(report._processed_tokens(row), 34)

    def test_plan_work_sums_legacy_and_normalized_phase_metrics(self) -> None:
        row = {
            "workflow": "plan-work",
            "plan_phase_telemetry": {
                "tokens": {"input": 10, "cacheRead": 20, "cacheWrite": 1, "output": 3},
            },
            "work_phase_telemetry": {
                "input_fresh": 4,
                "input_cache_read": 5,
                "input_cache_write": 0,
                "output": 6,
            },
        }

        self.assertEqual(report._token_metric(row, "input_fresh"), 14)
        self.assertEqual(report._token_metric(row, "input_cache_read"), 25)
        self.assertEqual(report._token_metric(row, "input_cache_write"), 1)
        self.assertEqual(report._token_metric(row, "output"), 9)
        self.assertEqual(report._processed_tokens(row), 49)

    def test_report_keeps_cache_separate_from_processed_total(self) -> None:
        work_only = [{
            "workflow": "work-only",
            "telemetry": {
                "input_fresh": 10,
                "input_cache_read": 20,
                "input_cache_write": 0,
                "output": 3,
                "tool_errors": 0,
            },
            "wall_time_s": 1,
        }]
        plan_work = [{
            "workflow": "plan-work",
            "plan_phase_telemetry": {
                "input_fresh": 4,
                "input_cache_read": 5,
                "input_cache_write": 0,
                "output": 6,
                "tool_errors": 0,
            },
            "work_phase_telemetry": {
                "input_fresh": 1,
                "input_cache_read": 2,
                "input_cache_write": 0,
                "output": 3,
                "tool_errors": 0,
            },
            "wall_time_s": 2,
        }]

        table = report.build_table("test", work_only, plan_work)

        self.assertIn("| Fresh Input | 10 | 5 | -5 |", table)
        self.assertIn("| Cache Read | 20 | 7 | -13 |", table)
        self.assertIn("| Verarbeitete Tokens (Summe obiger Werte) | 33 | 21 | -12 |", table)

    def test_phase_tool_errors_prefer_new_plan_work_traces(self) -> None:
        # P1: _phase_tool_errors zieht Pi Plan->Work-Werte aus den neuen
        # Tooltrace-Summaries; Work-only weiterhin aus telemetry.
        wo_row = {
            "workflow": "work-only",
            "telemetry": {"tool_errors": 1},
        }
        pw_row = {
            "workflow": "plan-work",
            "plan_phase_telemetry": {},
            "work_phase_telemetry": {},
            "plan_phase_tool_trace": {"tool_errors": 2},
            "work_phase_tool_trace": {"tool_errors": 3},
            "tool_trace_summary": {"tool_errors": 5},
        }
        self.assertEqual(report._phase_tool_errors(wo_row, "total"), 1)
        self.assertIsNone(report._phase_tool_errors(wo_row, "plan"))
        self.assertEqual(report._phase_tool_errors(pw_row, "plan"), 2)
        self.assertEqual(report._phase_tool_errors(pw_row, "work"), 3)
        self.assertEqual(report._phase_tool_errors(pw_row, "total"), 5)

    def test_phase_tool_errors_falls_back_to_legacy_telemetry(self) -> None:
        # Historische Zeile ohne neue Tooltrace-Felder (z.B. Stufe-1-Archiv):
        # Fallback auf plan-/work_phase_telemetry.tool_errors (Codex hat diese).
        pw_row = {
            "workflow": "plan-work",
            "plan_phase_telemetry": {"tool_errors": 1},
            "work_phase_telemetry": {"tool_errors": 2},
        }
        self.assertEqual(report._phase_tool_errors(pw_row, "plan"), 1)
        self.assertEqual(report._phase_tool_errors(pw_row, "work"), 2)
        self.assertEqual(report._phase_tool_errors(pw_row, "total"), 3)

    def test_build_combined_table_reads_four_cells_from_jsonl(self) -> None:
        # P0: kombinierte Vier-Spalten-Tabelle direkt aus results.jsonl —
        # die Smoke-Section-5-Werte duerfen nicht mehr manuell verwechselt
        # werden koennen.
        wo_by = {
            "codex-real": [{"workflow": "work-only", "harness": "codex-real",
                            "wall_time_s": 70.269,
                            "telemetry": {"input_fresh": 14697, "input_cache_read": 73728,
                                           "output": 630, "tool_errors": 0}}],
            "pi-real": [{"workflow": "work-only", "harness": "pi-real",
                         "wall_time_s": 31.284,
                         "telemetry": {"input_fresh": 17726, "input_cache_read": 44544,
                                        "output": 345, "tool_errors": 1}}],
        }
        pw_by = {
            "codex-real": [{"workflow": "plan-work", "harness": "codex-real",
                            "wall_time_s": 128.516,
                            "plan_phase_telemetry": {"input_fresh": 17338, "input_cache_read": 89856,
                                                      "output": 2447, "tool_errors": 0},
                            "work_phase_telemetry": {"input_fresh": 11023, "input_cache_read": 103424,
                                                     "output": 1703, "tool_errors": 0}}],
            "pi-real": [{"workflow": "plan-work", "harness": "pi-real",
                         "wall_time_s": 68.544,
                         "plan_phase_telemetry": {},
                         "work_phase_telemetry": {}}],
        }
        table = report.build_combined_table(wo_by, pw_by)
        # Exakt die korrigierten Smoke-Werte reproduzierbar aus jsonl.
        self.assertIn("| Laufzeit (s) | 70.269 | 128.516 | 58.247 | 31.284 | 68.544 | 37.26 |", table)
        self.assertIn("| Toolfehler | 0 | 0 | 0 | 1 | – | – |", table)
        # Weder WO/PW vertauscht noch ein anderer Run darf die Zeile ergeben.
        self.assertNotIn("31.284 | 70.269", table)


class StatsTest(unittest.TestCase):
    def test_empty_returns_zero_n_and_none_fields(self) -> None:
        s = report._stats([])
        self.assertEqual(s, {"n": 0, "mean": None, "median": None, "min": None, "max": None})

    def test_single_value_all_fields_equal(self) -> None:
        s = report._stats([12.0])
        self.assertEqual(s["n"], 1)
        self.assertEqual(s["mean"], s["median"])
        self.assertEqual(s["min"], s["max"])
        self.assertEqual(s["mean"], 12.0)

    def test_three_values_computes_all(self) -> None:
        s = report._stats([10.0, 12.0, 14.0])
        self.assertEqual(s, {"n": 3, "mean": 12.0, "median": 12.0, "min": 10.0, "max": 14.0})

    def test_none_values_are_ignored(self) -> None:
        s = report._stats([10.0, None, 14.0])
        self.assertEqual(s["n"], 2)
        self.assertEqual(s["mean"], 12.0)


class FormatStatCellTest(unittest.TestCase):
    def test_n0_is_na(self) -> None:
        self.assertEqual(report._format_stat_cell(report._stats([])), report.NA)

    def test_n1_matches_legacy_bare_number(self) -> None:
        self.assertEqual(report._format_stat_cell(report._stats([12.0])), "12.0")

    def test_n3_includes_n_and_median(self) -> None:
        cell = report._format_stat_cell(report._stats([10.0, 12.0, 14.0]))
        self.assertIn("n=3", cell)
        self.assertIn("Median 12.0", cell)
        self.assertIn("10.0", cell)
        self.assertIn("14.0", cell)


class DedupByRunIdTest(unittest.TestCase):
    def test_duplicate_run_id_keeps_last(self) -> None:
        rows = [
            {"run_id": "x", "wall_time_s": 1.0},
            {"run_id": "x", "wall_time_s": 999.0},  # z.B. versehentlicher Re-Run
            {"run_id": "y", "wall_time_s": 2.0},
        ]
        deduped = report._dedup_by_run_id(rows)
        self.assertEqual(len(deduped), 2)
        self.assertEqual(next(r for r in deduped if r["run_id"] == "x")["wall_time_s"], 999.0)

    def test_no_duplicates_keeps_all_rows_in_order(self) -> None:
        rows = [{"run_id": "a"}, {"run_id": "b"}, {"run_id": "c"}]
        self.assertEqual(report._dedup_by_run_id(rows), rows)


class MultiTrialAggregationTest(unittest.TestCase):
    def test_three_trial_rows_render_n_and_median_but_single_row_stays_legacy(self) -> None:
        # Bestehende n=1-Faelle (siehe test_report_keeps_cache_separate_from_processed_total)
        # muessen unveraendert bleiben; erst n>1 loest die erweiterte Darstellung aus.
        work_only_three_trials = [
            {"workflow": "work-only", "telemetry": {"tool_errors": 0}, "wall_time_s": w}
            for w in (10.0, 12.0, 14.0)
        ]
        plan_work_single = [{
            "workflow": "plan-work",
            "plan_phase_telemetry": {},
            "work_phase_telemetry": {},
            "wall_time_s": 2,
        }]
        table = report.build_table("test", work_only_three_trials, plan_work_single)
        self.assertIn("n=3", table)
        self.assertIn("Median 12.0", table)
        # Die Plan-Work-Seite (n=1) bleibt ein blosser Zahlenwert ohne "n=1".
        self.assertNotIn("n=1", table)


class ParseAllTasksSpecTest(unittest.TestCase):
    def test_parses_task_class_pairs_in_order(self) -> None:
        parsed = report._parse_all_tasks_spec([
            "real-03-lsp-ruby-profile:A",
            "real-04-session-health-provider-filter:B",
            "real-05-lsp-rename-tool:C",
        ])
        self.assertEqual(parsed, [
            ("real-03-lsp-ruby-profile", "A"),
            ("real-04-session-health-provider-filter", "B"),
            ("real-05-lsp-rename-tool", "C"),
        ])

    def test_missing_colon_raises(self) -> None:
        with self.assertRaises(ValueError):
            report._parse_all_tasks_spec(["real-03-lsp-ruby-profile"])


if __name__ == "__main__":
    unittest.main()
