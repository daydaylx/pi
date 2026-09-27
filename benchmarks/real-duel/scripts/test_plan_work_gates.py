#!/usr/bin/env python3
"""Regression tests for the Plan->Work hard gates (plan_work_gates.py).

Vor diesem Modul gab es hierfuer keine dedizierte Testdatei (real-03..05-
Analyse, P0) -- die beiden hier getesteten Gates (``required_tests_passed``,
``permission_policy_passed``) sind die dort neu ergaenzten, explizit
benannten Pflicht-Checks.
"""

from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("plan_work_gates.py")
spec = importlib.util.spec_from_file_location("plan_work_gates", SCRIPT)
gates = importlib.util.module_from_spec(spec)
assert spec.loader is not None
sys.modules["plan_work_gates"] = gates
spec.loader.exec_module(gates)


class RequiredTestsPassedGateTest(unittest.TestCase):
    def test_no_checker_is_non_required_and_passes(self) -> None:
        result = gates.check_required_tests_passed(has_checker=False, checker_exit=None)
        self.assertFalse(result.required)
        self.assertTrue(result.ok)

    def test_checker_exit_zero_passes(self) -> None:
        result = gates.check_required_tests_passed(has_checker=True, checker_exit=0)
        self.assertTrue(result.required)
        self.assertTrue(result.ok)

    def test_checker_nonzero_exit_fails_required(self) -> None:
        result = gates.check_required_tests_passed(has_checker=True, checker_exit=1)
        self.assertTrue(result.required)
        self.assertFalse(result.ok)

    def test_checker_not_run_despite_being_defined_fails(self) -> None:
        result = gates.check_required_tests_passed(has_checker=True, checker_exit=None)
        self.assertTrue(result.required)
        self.assertFalse(result.ok)


class PermissionPolicyPassedGateTest(unittest.TestCase):
    def test_no_categorisation_available_is_informative_only(self) -> None:
        # Codex im Plan-Work-Pfad hat keine Fehlerkategorisierung pro
        # Tool-Call -- ein fehlender Datenpunkt ist kein Policy-Verstoss.
        result = gates.check_permission_policy_passed(None)
        self.assertFalse(result.required)
        self.assertTrue(result.ok)

    def test_no_permission_errors_passes(self) -> None:
        result = gates.check_permission_policy_passed(["path", "unknown", None])
        self.assertTrue(result.required)
        self.assertTrue(result.ok)

    def test_permission_error_fails_required(self) -> None:
        result = gates.check_permission_policy_passed(["path", "permission"])
        self.assertTrue(result.required)
        self.assertFalse(result.ok)


class SummarizeTest(unittest.TestCase):
    def test_new_gates_are_folded_into_failed_required(self) -> None:
        summary = gates.summarize([
            gates.check_required_tests_passed(has_checker=True, checker_exit=1),
            gates.check_permission_policy_passed(["permission"]),
        ])
        self.assertFalse(summary["all_required_passed"])
        self.assertEqual(
            set(summary["failed_required"]),
            {"required_tests_passed", "permission_policy_passed"},
        )


if __name__ == "__main__":
    unittest.main()
