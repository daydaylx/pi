#!/usr/bin/env python3
"""Regression tests for candidate selection in the pi-duel wrapper."""

from __future__ import annotations

import runpy
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("pi-duel")
MODULE = runpy.run_path(str(SCRIPT))
CANDIDATES = MODULE["CANDIDATES"]
SELECT = MODULE["_selected_candidate_paths"]


class CandidateSelectionTest(unittest.TestCase):
    def test_default_keeps_both_candidates(self) -> None:
        self.assertEqual(SELECT(None), CANDIDATES)

    def test_explicit_candidate_selects_only_that_harness(self) -> None:
        selected = SELECT("pi-real")
        self.assertEqual(list(selected), ["pi-real"])
        self.assertEqual(selected["pi-real"], CANDIDATES["pi-real"])


if __name__ == "__main__":
    unittest.main()
