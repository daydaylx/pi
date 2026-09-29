#!/usr/bin/env python3
"""Regression tests fuer die Failure-Klassifikation und Provider-Signale."""

from __future__ import annotations

import importlib.util
import json
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("failure_class.py")
spec = importlib.util.spec_from_file_location("real_duel_failure_class", SCRIPT)
fc = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(fc)


def _jsonl(*events) -> str:
    return "\n".join(json.dumps(e) for e in events)


class ProviderSignalsTest(unittest.TestCase):
    def test_final_retry_failure_and_recovery_are_detected(self) -> None:
        text = _jsonl(
            {"type": "auto_retry_start", "attempt": 1},
            {"type": "auto_retry_end", "success": False, "attempt": 3, "finalError": "fetch failed"},
            {"type": "entry_appended", "entry": {"customType": "resilience.recovery-required"}},
        ) + "\nWarning: kein JSON"
        signals = fc.provider_signals(fc.iter_events(text))
        self.assertTrue(signals["failed"])
        self.assertTrue(signals["recovery_pending"])
        self.assertIn("fetch failed", signals["evidence"][0])

    def test_successful_retry_is_not_a_failure(self) -> None:
        signals = fc.provider_signals(fc.iter_events(_jsonl(
            {"type": "auto_retry_start", "attempt": 1},
            {"type": "auto_retry_end", "success": True, "attempt": 1},
        )))
        self.assertFalse(signals["failed"])

    def test_codex_turn_failed_is_detected(self) -> None:
        signals = fc.provider_signals(fc.iter_events(_jsonl(
            {"type": "turn.failed", "error": {"message": "stream disconnected"}},
        )))
        self.assertTrue(signals["failed"])


class ClassifyFailureTest(unittest.TestCase):
    def test_provider_abort_with_invalid_candidate_is_its_own_reason(self) -> None:
        result = fc.classify_failure(
            success=False, completed=False, error="Pflichtgates fehlgeschlagen",
            failed_gates=["required_tests_passed"], checker_exit=1,
            provider={"failed": True, "evidence": ["auto_retry_end success=false"]},
        )
        self.assertEqual(result["failure_class"], fc.PROVIDER_FAILURE)
        self.assertEqual(result["failure_reason"], fc.INTERRUPTED_INVALID)
        self.assertTrue(result["failure_evidence"])

    def test_provider_signal_does_not_hide_a_clean_pass(self) -> None:
        result = fc.classify_failure(
            success=True, completed=True, provider={"failed": True, "evidence": ["x"]},
        )
        self.assertEqual(result["failure_class"], fc.PASS)

    def test_pass_and_open_task(self) -> None:
        self.assertEqual(fc.classify_failure(success=True, completed=True)["failure_class"], fc.PASS)
        open_task = fc.classify_failure(success=None, completed=True)
        self.assertEqual(open_task["failure_class"], fc.PASS)
        self.assertEqual(open_task["failure_reason"], "no_checker_open_task")

    def test_policy_gate_vs_verification(self) -> None:
        policy = fc.classify_failure(
            success=True, completed=False, error="x", failed_gates=["forbidden_surface_untouched"],
        )
        self.assertEqual(policy["failure_class"], fc.POLICY_GATE_FAILURE)
        verification = fc.classify_failure(
            success=False, completed=False, error="x", failed_gates=["required_tests_passed"], checker_exit=1,
        )
        self.assertEqual(verification["failure_class"], fc.VERIFICATION_FAILURE)

    def test_harness_infrastructure_and_candidate(self) -> None:
        harness = fc.classify_failure(success=None, completed=False, error="boom", harness_exception=True)
        self.assertEqual(harness["failure_class"], fc.HARNESS_FAILURE)
        infra = fc.classify_failure(
            success=None, completed=False, error="x", tool_error_categories=["infrastructure"],
        )
        self.assertEqual(infra["failure_class"], fc.INFRASTRUCTURE_FAILURE)
        candidate = fc.classify_failure(success=None, completed=False, error="timeout")
        self.assertEqual(candidate["failure_class"], fc.CANDIDATE_FAILURE)


if __name__ == "__main__":
    unittest.main()
