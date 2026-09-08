#!/usr/bin/env python3
"""Regression tests for the P2 baseline preflight + comparable policy."""

from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path(__file__).with_name("baseline_preflight.py")
spec = importlib.util.spec_from_file_location("baseline_preflight", SCRIPT)
bp = importlib.util.module_from_spec(spec)
assert spec.loader is not None
sys.modules["baseline_preflight"] = bp
spec.loader.exec_module(bp)


class _FakeProc:
    def __init__(self, returncode, stdout="", stderr=""):
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr


def _fake_run_factory(outcomes):
    """outcomes: {check_name: (returncode, stdout, stderr)} -> callable
    matching subprocess.run(cmd, ...)."""

    def _fake_run(cmd, *args, **kwargs):
        # cmd = ["npm", "--prefix", "npm", "run", "<check>"]
        check = cmd[-1]
        rc, out, err = outcomes.get(check, (0, "", ""))
        return _FakeProc(rc, out, err)

    return _fake_run


class RunPreflightTest(unittest.TestCase):
    def test_clean_baseline_when_all_checks_exit_zero(self) -> None:
        fake = _fake_run_factory({"format:check": (0, "all good", ""),
                                   "typecheck": (0, "", "")})
        with patch("baseline_preflight.subprocess.run", side_effect=fake):
            result = bp.run_preflight("/tmp/workdir", ("format:check", "typecheck"))
        self.assertEqual(result["status"], "clean")
        self.assertEqual(result["failures"], [])
        self.assertEqual([c["exit_code"] for c in result["checks"]], [0, 0])

    def test_failing_baseline_records_check_fingerprint_only(self) -> None:
        fake = _fake_run_factory({
            "format:check": (1, ">> format error in src/a.ts:4\n", ""),
            "typecheck": (0, "", ""),
        })
        with patch("baseline_preflight.subprocess.run", side_effect=fake):
            result = bp.run_preflight("/tmp/workdir", ("format:check", "typecheck"))
        self.assertEqual(result["status"], "failing")
        self.assertEqual(len(result["failures"]), 1)
        failure = result["failures"][0]
        self.assertEqual(failure["check"], "format:check")
        self.assertEqual(failure["exit_code"], 1)
        # Privacy: nur ein SHA-256, kein Quelltext/Pfad-Inhalt.
        self.assertIsInstance(failure["fingerprint"], str)
        self.assertNotIn("src/a.ts", failure["fingerprint"])
        self.assertNotIn("format error", failure["fingerprint"])

class BaselineContextTest(unittest.TestCase):
    def test_clean_status_has_empty_failures(self) -> None:
        ctx = bp.baseline_context({"status": "clean", "failures": []})
        self.assertEqual(ctx.status, "clean")
        self.assertEqual(ctx.failures, {})

    def test_failing_status_maps_check_to_fingerprint(self) -> None:
        ctx = bp.baseline_context({
            "status": "failing",
            "failures": [{"check": "format:check", "exit_code": 1, "fingerprint": "abc"}],
        })
        self.assertEqual(ctx.status, "failing")
        self.assertEqual(ctx.failures, {"format:check": "abc"})

    def test_unknown_status_preserved_not_collapsed_to_none(self) -> None:
        # Vor dem P2-Fix ergab status="unknown" denselben Rueckgabewert
        # (None) wie status="clean" -- ununterscheidbar, siehe
        # _refine_verification_category in tool_trace.py.
        ctx = bp.baseline_context({"status": "unknown", "failures": [], "checks": []})
        self.assertIsNotNone(ctx)
        self.assertEqual(ctx.status, "unknown")

    def test_skipped_status_preserved_not_collapsed_to_none(self) -> None:
        ctx = bp.baseline_context({"status": "skipped", "failures": [], "checks": []})
        self.assertIsNotNone(ctx)
        self.assertEqual(ctx.status, "skipped")

    def test_none_preflight_returns_none(self) -> None:
        self.assertIsNone(bp.baseline_context(None))

    def test_unrecognized_status_returns_none(self) -> None:
        self.assertIsNone(bp.baseline_context({"status": "weird", "failures": []}))


class ComparablePolicyTest(unittest.TestCase):
    def test_case1_baseline_clean_candidate_clean(self) -> None:
        comparable, reason = bp.decide_comparable(
            baseline_preflight={"status": "clean", "failures": []},
            dirty_override=False,
            candidate_tool_errors=[],
            candidate_regressions=[],
        )
        self.assertTrue(comparable)
        self.assertEqual(reason, "baseline_clean")

    def test_case2_baseline_failing_candidate_does_not_touch_area(self) -> None:
        # Baseline format:check scheitert; der Kandidat verursacht KEINEN
        # Verifier-Fehler an diesem Check -> pre_existing, vergleichbar.
        candidate_errors = [
            {"tool": "read", "error_category": "permission"},  # taskfremder Fehler
        ]
        comparable, reason = bp.decide_comparable(
            baseline_preflight={
                "status": "failing",
                "failures": [{"check": "format:check", "exit_code": 1, "fingerprint": "abc"}],
            },
            dirty_override=False,
            candidate_tool_errors=candidate_errors,
            candidate_regressions=[],
        )
        self.assertTrue(comparable)
        self.assertEqual(reason, "baseline_failing_pre_existing")

    def test_case3_baseline_clean_candidate_introduces_new_error(self) -> None:
        candidate_errors = [
            {"tool": "project_check", "error_category": "verification/regression",
             "error_summary": "Eine Verifikationspruefung schlug fehl."},
        ]
        comparable, reason = bp.decide_comparable(
            baseline_preflight={"status": "clean", "failures": []},
            dirty_override=False,
            candidate_tool_errors=candidate_errors,
            candidate_regressions=candidate_errors,
        )
        # Lauf bleibt vergleichbar; die Regression bleibt markiert, statt den
        # Lauf zu verwerfen.
        self.assertTrue(comparable)
        self.assertEqual(reason, "baseline_clean_candidate_regression")

    def test_case3b_baseline_failing_candidate_verifier_blocked(self) -> None:
        # Fall 3: der Kandidat scheitert mit seinem eigenen Verifier genau an
        # dem dokumentierten Baselinefehler -> taskfremder Fehler blockiert den
        # Harness-Vergleich -> comparable=false.
        candidate_errors = [
            {"tool": "project_check", "error_category": "verification/baseline",
             "error_summary": "Verifikationslauf meldete Format-Drift."},
        ]
        comparable, reason = bp.decide_comparable(
            baseline_preflight={
                "status": "failing",
                "failures": [{"check": "format:check", "exit_code": 1, "fingerprint": "abc"}],
            },
            dirty_override=False,
            candidate_tool_errors=candidate_errors,
            candidate_regressions=[],
        )
        self.assertFalse(comparable)
        self.assertEqual(reason, "baseline_failing_candidate_verifier_blocked")

    def test_dirty_override_always_not_comparable(self) -> None:
        comparable, reason = bp.decide_comparable(
            baseline_preflight={"status": "clean", "failures": []},
            dirty_override=True,
        )
        self.assertFalse(comparable)
        self.assertEqual(reason, "dirty_override")


class ClassifyCandidateErrorsTest(unittest.TestCase):
    def test_pre_existing_and_regression_partition(self) -> None:
        errors = [
            {"error_category": "verification/baseline"},   # pre_existing
            {"error_category": "verification/regression"},  # regression
            {"error_category": "permission"},               # neither (raw)
            {"error_category": "verification/baseline"},   # pre_existing
        ]
        baseline = {"status": "failing",
                    "failures": [{"check": "format:check", "exit_code": 1, "fingerprint": "x"}]}
        out = bp.classify_candidate_errors(errors, baseline)
        self.assertEqual(out["pre_existing"], [0, 3])
        self.assertEqual(out["regression"], [1])
        # baseline_fixed bleibt konservativ leer (tool_trace zeichnet keine
        # Erfolge auf; dokumentierte Luecke).
        self.assertEqual(out["baseline_fixed"], [])


if __name__ == "__main__":
    unittest.main()
