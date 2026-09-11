#!/usr/bin/env python3
"""Regression tests for candidate selection in the pi-duel wrapper."""

from __future__ import annotations

import argparse
import re
import runpy
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("pi-duel")
MODULE = runpy.run_path(str(SCRIPT))
CANDIDATES = MODULE["CANDIDATES"]
CANDIDATE_PROFILES = MODULE["CANDIDATE_PROFILES"]
SELECT = MODULE["_selected_candidate_paths"]
POSITIVE_INT = MODULE["_positive_int"]
BUILD_PARSER = MODULE["build_parser"]
BUILD_RUN_ID_BASE = MODULE["_build_run_id_base"]
LINK_NODE_MODULES = MODULE["_link_node_modules"]


class CandidateSelectionTest(unittest.TestCase):
    def test_default_keeps_both_candidates(self) -> None:
        self.assertEqual(SELECT(None), CANDIDATES)

    def test_explicit_candidate_selects_only_that_harness(self) -> None:
        selected = SELECT("pi-real")
        self.assertEqual(list(selected), ["pi-real"])
        self.assertEqual(selected["pi-real"], CANDIDATES["pi-real"])

    def test_medium_profile_selects_the_separate_manifests(self) -> None:
        selected = SELECT(None, "medium")
        self.assertEqual(selected, CANDIDATE_PROFILES["medium"])
        self.assertNotEqual(selected["pi-real"], CANDIDATES["pi-real"])
        self.assertNotEqual(selected["codex-real"], CANDIDATES["codex-real"])

    def test_medium_manifests_pin_the_same_reasoning_level(self) -> None:
        self.assertIn('"--thinking", "medium"', CANDIDATE_PROFILES["medium"]["pi-real"].read_text())
        self.assertIn(
            '"model_reasoning_effort=medium"',
            CANDIDATE_PROFILES["medium"]["codex-real"].read_text(),
        )


class PositiveIntTest(unittest.TestCase):
    def test_accepts_positive_integers(self) -> None:
        self.assertEqual(POSITIVE_INT("1"), 1)
        self.assertEqual(POSITIVE_INT("2"), 2)

    def test_rejects_zero_and_negative(self) -> None:
        for bad in ("0", "-1"):
            with self.assertRaises(argparse.ArgumentTypeError):
                POSITIVE_INT(bad)

    def test_rejects_non_integer(self) -> None:
        with self.assertRaises(argparse.ArgumentTypeError):
            POSITIVE_INT("abc")


class TrialCliTest(unittest.TestCase):
    def test_smoke_trial_defaults_to_one(self) -> None:
        args = BUILD_PARSER().parse_args(["smoke"])
        self.assertEqual(args.trial, 1)

    def test_smoke_trial_override(self) -> None:
        args = BUILD_PARSER().parse_args(["smoke", "--trial", "2"])
        self.assertEqual(args.trial, 2)

    def test_reasoning_defaults_to_high_and_accepts_medium(self) -> None:
        self.assertEqual(BUILD_PARSER().parse_args(["smoke"]).reasoning, "high")
        self.assertEqual(
            BUILD_PARSER().parse_args(["run", "--task", "x", "--reasoning", "medium"]).reasoning,
            "medium",
        )

    def test_run_trial_same_semantics_as_smoke(self) -> None:
        args = BUILD_PARSER().parse_args(["run", "--task", "x", "--trial", "2"])
        self.assertEqual(args.trial, 2)

    def test_run_trial_defaults_to_one(self) -> None:
        args = BUILD_PARSER().parse_args(["run", "--task", "x"])
        self.assertEqual(args.trial, 1)

    def test_trial_zero_rejected_on_both_subcommands(self) -> None:
        for argv in (["smoke", "--trial", "0"], ["run", "--task", "x", "--trial", "0"]):
            with self.assertRaises(SystemExit):
                BUILD_PARSER().parse_args(argv)

    def test_trial_negative_rejected(self) -> None:
        with self.assertRaises(SystemExit):
            BUILD_PARSER().parse_args(["smoke", "--trial", "-1"])


class RunIdBaseTest(unittest.TestCase):
    def test_includes_trial_segment(self) -> None:
        base = BUILD_RUN_ID_BASE("smoke-01", 2)
        self.assertRegex(base, r"^smoke-01-trial2-\d{8}T\d{6}$")

    def test_differs_between_trials(self) -> None:
        b1 = BUILD_RUN_ID_BASE("smoke-01", 1)
        b2 = BUILD_RUN_ID_BASE("smoke-01", 2)
        self.assertNotEqual(b1.split("-trial", 1)[1], b2.split("-trial", 1)[1])


class LinkNodeModulesTest(unittest.TestCase):
    """Ein frischer git worktree hat kein node_modules (gitignored) --
    format:check/typecheck (Baseline-Preflight-Default) wuerden sonst in
    JEDEM Worktree mit 'command not found' fehlschlagen, was baseline_status
    faelschlich immer 'failing' statt 'clean' macht."""

    def test_hardlinks_existing_node_modules_into_worktree(self) -> None:
        # runpy.run_path() gibt eine Kopie der Modul-Globals zurueck, nicht
        # das Dict, auf das Funktions-__globals__ tatsaechlich zeigen --
        # REPO muss daher ueber __globals__ der Funktion selbst gepatcht
        # werden, nicht ueber MODULE["REPO"].
        globals_ = LINK_NODE_MODULES.__globals__
        with tempfile.TemporaryDirectory() as tmp:
            fake_repo = Path(tmp) / "repo"
            fake_wt = Path(tmp) / "wt"
            (fake_repo / "npm" / "node_modules" / "pkg").mkdir(parents=True)
            (fake_repo / "npm" / "node_modules" / "pkg" / "index.js").write_text("x")
            fake_wt.mkdir()
            original_repo = globals_["REPO"]
            globals_["REPO"] = fake_repo
            try:
                LINK_NODE_MODULES(fake_wt)
            finally:
                globals_["REPO"] = original_repo
            self.assertTrue((fake_wt / "npm" / "node_modules" / "pkg" / "index.js").exists())

    def test_missing_source_is_silently_skipped(self) -> None:
        globals_ = LINK_NODE_MODULES.__globals__
        with tempfile.TemporaryDirectory() as tmp:
            fake_repo = Path(tmp) / "repo-empty"
            fake_repo.mkdir()
            fake_wt = Path(tmp) / "wt2"
            fake_wt.mkdir()
            original_repo = globals_["REPO"]
            globals_["REPO"] = fake_repo
            try:
                LINK_NODE_MODULES(fake_wt)  # kein node_modules vorhanden -- darf nicht werfen
            finally:
                globals_["REPO"] = original_repo
            self.assertFalse((fake_wt / "npm").exists())


class TrialHardcodingRegressionTest(unittest.TestCase):
    """Grep-basierter Schutz: verhindert ein Zurueckrutschen auf die
    hartkodierte Trial-1-Konstante, ohne einen echten Lauf zu brauchen."""

    def test_no_hardcoded_trial_one_literal(self) -> None:
        source = SCRIPT.read_text(encoding="utf-8")
        self.assertNotIn('"trial": 1,', source)
        self.assertEqual(len(re.findall(r'"trial": args\.trial,', source)), 2)


if __name__ == "__main__":
    unittest.main()
