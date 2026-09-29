#!/usr/bin/env python3
"""Regression tests fuer die getrennten Verifikations-Feldnamen."""

from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("field_names.py")
spec = importlib.util.spec_from_file_location("real_duel_field_names", SCRIPT)
fn = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(fn)


class FieldNamesTest(unittest.TestCase):
    def test_legacy_row_gets_all_three_concepts_separated(self) -> None:
        row = {
            "checker_exit": 0, "checker_stdout": "SCORE:100", "checker_stderr": "",
            "checker_wall_time_s": 3.5,
            "tool_error_details": [
                {"error_category": "verification/baseline"},
                {"error_category": "verification/regression"},
                {"error_category": "unknown"},
            ],
            "subagent_telemetry": {"verifier_calls": 0, "verifier_decision": None},
            "comparable_reason": "baseline_failing_candidate_verifier_blocked",
        }
        merged = fn.with_new_field_names(row)
        self.assertEqual(merged["benchmark_checker_exit"], 0)
        self.assertEqual(merged["benchmark_checker_wall_time_s"], 3.5)
        self.assertTrue(merged["verification_gate_blocked"])
        self.assertEqual(merged["verification_gate_errors"], 2)
        self.assertEqual(merged["model_verifier_calls"], 0)
        self.assertEqual(merged["comparable_reason"], "baseline_failing_verification_gate_blocked")

    def test_verifier_calls_zero_next_to_blocked_gate_is_not_contradictory(self) -> None:
        merged = fn.with_new_field_names({
            "tool_error_details": [{"error_category": "verification/baseline"}],
            "telemetry": {"verifier_calls": 0},
        })
        self.assertEqual(merged["model_verifier_calls"], 0)
        self.assertTrue(merged["verification_gate_blocked"])

    def test_missing_sources_stay_none_not_guessed(self) -> None:
        out = fn.row_naming_fields({})
        self.assertIsNone(out["verification_gate_blocked"])
        self.assertIsNone(out["benchmark_checker_exit"])
        self.assertNotIn("model_verifier_calls", out)

    def test_existing_new_fields_win_over_derived(self) -> None:
        merged = fn.with_new_field_names({"checker_exit": 1, "benchmark_checker_exit": 0})
        self.assertEqual(merged["benchmark_checker_exit"], 0)

    def test_add_model_verifier_aliases_keeps_legacy_keys(self) -> None:
        stats = fn.add_model_verifier_aliases({"verifier_calls": 2, "verifier_model": "m"})
        self.assertEqual(stats["verifier_calls"], 2)
        self.assertEqual(stats["model_verifier_calls"], 2)
        self.assertEqual(stats["model_verifier_model"], "m")


if __name__ == "__main__":
    unittest.main()
