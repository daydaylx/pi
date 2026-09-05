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


if __name__ == "__main__":
    unittest.main()
