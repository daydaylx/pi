#!/usr/bin/env python3
"""Small regression fixtures for Pi usage/event accounting."""

from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("telemetry.py")
spec = importlib.util.spec_from_file_location("real_duel_telemetry", SCRIPT)
telemetry = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(telemetry)


def _usage() -> dict:
    return {
        "input": 236_560,
        "cacheRead": 2_830_848,
        "cacheWrite": 0,
        "output": 15_788,
        "reasoning": 1_000,
        "totalTokens": 3_083_196,
    }


def _pi_fixture() -> str:
    usage = _usage()
    events = [
        # The same provider usage is deliberately present on both event
        # surfaces. A correct adapter must count it once.
        {"type": "message_end", "message": {
            "role": "assistant", "usage": usage,
        }},
        {"type": "turn_end", "message": {
            "role": "assistant", "usage": usage,
        }},
        # A retry/provider failure has no usage and must not create tokens.
        {"type": "message_update", "assistantMessageEvent": {
            "type": "error", "error": {"errorMessage": "retry"},
        }},
        # Partial usage is ignored rather than completed with guessed zeros.
        {"type": "turn_end", "message": {
            "role": "assistant", "usage": {"input": 99, "output": 7},
        }},
    ]
    return "\n".join(json.dumps(event) for event in events)


class PiTelemetryTest(unittest.TestCase):
    def test_duplicate_surfaces_retry_and_partial_usage(self) -> None:
        adapter, _ = telemetry._load_adapters()
        _legacy, turns, _tail, usage = adapter._parse_json_with_usage(_pi_fixture())

        self.assertEqual(turns, 2)
        self.assertEqual(usage["tokens_input_uncached"], 236_560)
        self.assertEqual(usage["tokens_cache_read"], 2_830_848)
        self.assertEqual(usage["tokens_cache_write"], 0)
        self.assertEqual(usage["tokens_output"], 15_788)
        # The partial retry record is visible, so the adapter truthfully marks
        # the complete totals as estimated; it still does not add guessed
        # fields or count the duplicate surface.
        self.assertEqual(usage["token_basis"], "estimated")
        self.assertEqual(
            sum(
                usage[key]
                for key in (
                    "tokens_input_uncached",
                    "tokens_cache_read",
                    "tokens_cache_write",
                    "tokens_output",
                )
            ),
            3_083_196,
        )

    def test_no_usage_keeps_observable_counts_without_fabricating_tokens(self) -> None:
        stream = "\n".join([
            json.dumps({"type": "turn_end", "message": {"role": "assistant"}}),
            json.dumps({"type": "message_end", "message": {
                "role": "toolResult", "isError": True,
            }}),
        ])
        normalized = telemetry.normalize_pi(stream)
        self.assertEqual(normalized["model_calls"], 1)
        self.assertIsNone(normalized["input_fresh"])
        self.assertIsNone(normalized["output"])
        self.assertEqual(normalized["tool_calls"], 0)
        self.assertEqual(normalized["tool_errors"], 1)


class NestedStatsTest(unittest.TestCase):
    """Verifier-Risk-Router-Telemetrie (05_TELEMETRIE_SPEZIFIKATION.md):
    nested/verifier-Breakdown ohne Doppelzaehlung, all_in als main + nested."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.history_path = Path(self._tmp.name) / "run-history.jsonl"
        self._original_path = telemetry.RUN_HISTORY_PATH
        telemetry.RUN_HISTORY_PATH = str(self.history_path)
        self.addCleanup(setattr, telemetry, "RUN_HISTORY_PATH", self._original_path)
        self.workdir = str(Path(self._tmp.name) / "trial-workdir")

    def _write_entries(self, entries) -> None:
        with open(self.history_path, "w", encoding="utf-8") as fh:
            for entry in entries:
                fh.write(json.dumps(entry) + "\n")

    def test_verifier_is_a_subset_of_nested_not_an_addend(self) -> None:
        self._write_entries([
            {
                "agent": "investigator", "cwd": self.workdir, "ts": 100,
                "duration": 1000, "tokens": {"input": 100, "output": 10, "cacheRead": 0},
                "cost": 0.01,
            },
            {
                "agent": "verifier", "cwd": self.workdir, "ts": 101,
                "duration": 2000, "tokens": {"input": 200, "output": 20, "cacheRead": 50},
                "cost": 0.02,
            },
        ])
        stats = telemetry.subagent_stats_from_run_history(self.workdir, 0, 200)

        self.assertEqual(stats["nested_calls"], 2, "both entries count toward nested")
        self.assertEqual(stats["verifier_calls"], 1, "only the verifier entry counts toward verifier")
        self.assertEqual(stats["nested_fresh_input"], 300, "nested sums both entries' input")
        self.assertEqual(stats["verifier_fresh_input"], 200, "verifier sums only its own entry")
        self.assertAlmostEqual(stats["nested_cost"], 0.03)
        self.assertAlmostEqual(stats["verifier_cost"], 0.02)
        self.assertEqual(stats["nested_wall_time"], 3000)
        self.assertEqual(stats["verifier_wall_time"], 2000)
        # Old history rows remain readable; unavailable fields are not guessed.
        self.assertIsNone(stats["verifier_model"])
        self.assertIsNone(stats["verifier_reasoning"])
        self.assertIsNone(stats["verifier_internal_tool_calls"])
        self.assertIsNone(stats["verifier_decision"])
        self.assertEqual(stats["nested_models"], [])
        self.assertIsNone(stats["mixed_model_run"])

    def test_optional_fork_metadata_is_aggregated_without_losing_unknowns(self) -> None:
        self._write_entries([
            {
                "agent": "worker", "cwd": self.workdir, "ts": 100,
                "duration": 500, "model": "provider/model-a",
            },
            {
                "agent": "verifier", "cwd": self.workdir, "ts": 101,
                "duration": 800, "model": "provider/model-b",
                "reasoningTokens": 24, "internalToolCalls": 3,
                "verifierDecision": "required", "verifierTrigger": "user_requested",
                "verifierSkipReason": "",
            },
        ])
        stats = telemetry.subagent_stats_from_run_history(self.workdir, 0, 200)

        self.assertEqual(stats["nested_models"], ["provider/model-a", "provider/model-b"])
        self.assertTrue(stats["mixed_model_run"])
        self.assertEqual(stats["verifier_model"], "provider/model-b")
        self.assertEqual(stats["verifier_reasoning"], 24)
        self.assertEqual(stats["verifier_internal_tool_calls"], 3)
        self.assertEqual(stats["verifier_decision"], "required")
        self.assertEqual(stats["verifier_trigger"], "user_requested")
        self.assertEqual(stats["verifier_skip_reason"], "")

    def test_metadata_from_unrelated_or_out_of_window_entries_is_excluded(self) -> None:
        self._write_entries([
            {
                "agent": "verifier", "cwd": "/unrelated/other-repo", "ts": 100,
                "duration": 1, "model": "leak/model", "reasoningTokens": 999,
            },
            {
                "agent": "verifier", "cwd": self.workdir, "ts": 5000,
                "duration": 1, "model": "late/model", "internalToolCalls": 999,
            },
        ])
        stats = telemetry.subagent_stats_from_run_history(self.workdir, 0, 200)
        self.assertEqual(stats["nested_models"], [])
        self.assertIsNone(stats["verifier_reasoning"])
        self.assertIsNone(stats["verifier_internal_tool_calls"])
        self.assertIsNone(stats["mixed_model_run"])

    def test_incomplete_metadata_is_not_interpreted_as_zero_or_complete(self) -> None:
        self._write_entries([
            {
                "agent": "verifier", "cwd": self.workdir, "ts": 100,
                "duration": 1, "model": "provider/model-a",
                "reasoningTokens": 10,
            },
            {
                "agent": "worker", "cwd": self.workdir, "ts": 101,
                "duration": 1,
            },
        ])
        stats = telemetry.subagent_stats_from_run_history(self.workdir, 0, 200)
        self.assertEqual(stats["nested_models"], ["provider/model-a"])
        self.assertIsNone(stats["mixed_model_run"])
        self.assertEqual(stats["verifier_reasoning"], 10)
        self.assertIsNone(stats["verifier_internal_tool_calls"])

    def test_entries_outside_workdir_or_time_window_are_excluded(self) -> None:
        self._write_entries([
            {
                "agent": "verifier", "cwd": "/unrelated/other-repo", "ts": 100,
                "duration": 500, "tokens": {"input": 999}, "cost": 9.0,
            },
            {
                "agent": "verifier", "cwd": self.workdir, "ts": 5000,
                "duration": 500, "tokens": {"input": 999}, "cost": 9.0,
            },
        ])
        stats = telemetry.subagent_stats_from_run_history(self.workdir, 0, 200)
        self.assertEqual(stats["nested_calls"], 0, "neither entry belongs to this trial")
        self.assertEqual(stats["verifier_calls"], 0)

    def test_no_entries_is_a_measured_zero_not_a_missing_value(self) -> None:
        self._write_entries([])
        stats = telemetry.subagent_stats_from_run_history(self.workdir, 0, 200)
        self.assertEqual(stats["nested_calls"], 0)
        self.assertIsNone(stats["nested_cost"], "no cost observations means None, not 0")


class AllInViewTest(unittest.TestCase):
    def test_all_in_is_main_plus_nested_never_plus_verifier_again(self) -> None:
        main_stats = {
            "input_fresh": 1000, "input_cache_read": 200, "output": 50, "cost": 0.10,
        }
        nested_stats = {
            "nested_fresh_input": 300, "nested_cache_read": 50, "nested_output": 20,
            "nested_cost": 0.03,
        }
        combined = telemetry.all_in_view(main_stats, nested_stats)
        self.assertEqual(combined["all_in_fresh_input"], 1300)
        self.assertEqual(combined["all_in_cache_read"], 250)
        self.assertEqual(combined["all_in_output"], 70)
        self.assertAlmostEqual(combined["all_in_cost"], 0.13)

    def test_missing_value_propagates_as_none_not_zero(self) -> None:
        combined = telemetry.all_in_view({"input_fresh": None}, {"nested_fresh_input": 10})
        self.assertIsNone(combined["all_in_fresh_input"])


def _pi_event(usage) -> list:
    message = {"role": "assistant", "usage": usage}
    return [{"type": "message_end", "message": message},
            {"type": "turn_end", "message": message}]


def _codex_transcript(usage, commands=0, errors=0) -> str:
    events = [{"type": "thread.started"}]
    for i in range(commands):
        events.append({"type": "item.completed", "item": {
            "type": "command_execution", "exit_code": 1 if i < errors else 0,
        }})
    events.append({"type": "turn.completed", "usage": usage})
    return "\n".join(json.dumps(e) for e in events)


def _codex_usage(inp, cached, out, reasoning) -> dict:
    return {"input_tokens": inp, "cached_input_tokens": cached,
            "cache_write_input_tokens": 0, "output_tokens": out,
            "reasoning_output_tokens": reasoning}


class PlanWorkTelemetryTest(unittest.TestCase):
    def test_sum_neutral_adds_and_propagates_none(self) -> None:
        a = telemetry._empty_neutral()
        b = telemetry._empty_neutral()
        a.update({"input_fresh": 10, "output": 5, "tool_calls": 2, "cost": None,
                  "token_basis": "vendor_split", "cost_source": "unavailable"})
        b.update({"input_fresh": 20, "output": None, "tool_calls": 3, "cost": 0.5,
                  "token_basis": "vendor_split", "cost_source": "unavailable"})
        total = telemetry.sum_neutral(a, b)
        self.assertEqual(total["input_fresh"], 30)
        self.assertEqual(total["tool_calls"], 5)
        self.assertIsNone(total["output"])
        self.assertIsNone(total["cost"])
        self.assertEqual(total["token_basis"], "vendor_split")

    def test_pi_plan_work_has_phases_and_total_including_reasoning(self) -> None:
        plan = _pi_event({"input": 100, "cacheRead": 1000, "cacheWrite": 0, "output": 10,
                           "reasoning": 4, "totalTokens": 1114, "cost": {"total": 0.01}})
        work = _pi_event({"input": 200, "cacheRead": 3000, "cacheWrite": 0, "output": 30,
                           "reasoning": 6, "totalTokens": 3236, "cost": {"total": 0.02}})
        result = telemetry.pi_plan_work_telemetry(plan, work)
        self.assertEqual(result["plan"]["input_fresh"], 100)
        self.assertEqual(result["work"]["input_cache_read"], 3000)
        total = result["total"]
        self.assertEqual(total["input_fresh"], 300)
        self.assertEqual(total["input_cache_read"], 4000)
        self.assertEqual(total["output"], 40)
        self.assertEqual(total["reasoning"], 10)
        self.assertAlmostEqual(total["cost"], 0.03)
        self.assertEqual(total["model_calls"], 2)
        scalars = telemetry.legacy_scalars(total)
        self.assertEqual(scalars["tokens"], 340)
        self.assertEqual(scalars["turns"], 2)

    def test_pi_phase_without_usage_keeps_total_tokens_unset(self) -> None:
        result = telemetry.pi_plan_work_telemetry(
            [{"type": "message_end", "message": {"role": "assistant", "usage": {"input": 0, "output": 0}}}],
            _pi_event({"input": 5, "cacheRead": 0, "cacheWrite": 0, "output": 1, "totalTokens": 6}),
        )
        self.assertIsNone(result["total"]["input_fresh"])
        self.assertIsNone(telemetry.legacy_scalars(result["total"])["tokens"])

    def test_codex_counts_are_per_transcript_tokens_are_cumulative(self) -> None:
        plan = _codex_transcript(_codex_usage(1000, 800, 50, 20), commands=3, errors=0)
        work = _codex_transcript(_codex_usage(5000, 4200, 300, 120), commands=4, errors=2)
        split = telemetry.split_codex_plan_work(plan, work)
        self.assertTrue(split["consistent"])
        self.assertEqual(split["work_phase_delta"]["input_fresh"], 600)
        self.assertEqual(split["work_phase_delta"]["tool_calls"], 4)
        self.assertEqual(split["work_phase_delta"]["tool_errors"], 2)
        total = split["total"]
        self.assertEqual(total["input_fresh"], 800)
        self.assertEqual(total["output"], 300)
        self.assertEqual(total["reasoning"], 120)
        self.assertEqual(total["tool_calls"], 7)
        self.assertEqual(total["model_calls"], 2)
        self.assertIsNone(total["cost"])
        merged = telemetry.codex_plan_work_telemetry(split)
        self.assertIsNone(merged["telemetry_gap_reason"])

    def test_codex_inconsistent_usage_sums_both_phases(self) -> None:
        plan = _codex_transcript(_codex_usage(1000, 800, 50, 20), commands=1)
        work = _codex_transcript(_codex_usage(300, 100, 10, 5), commands=1)
        split = telemetry.split_codex_plan_work(plan, work)
        self.assertFalse(split["consistent"])
        self.assertEqual(split["total"]["output"], 60)
        self.assertEqual(split["total"]["tool_calls"], 2)

    def test_codex_missing_usage_gives_reason_and_null_tokens(self) -> None:
        plan = "\n".join([json.dumps({"type": "thread.started"})])
        work = _codex_transcript(_codex_usage(5000, 4200, 300, 120), commands=2)
        split = telemetry.split_codex_plan_work(plan, work)
        merged = telemetry.codex_plan_work_telemetry(split)
        self.assertIsNone(merged["total"]["input_fresh"])
        self.assertIn("token_basis", merged["telemetry_gap_reason"])

    def test_subagent_stats_carry_model_verifier_aliases(self) -> None:
        stats = telemetry.subagent_stats_from_run_history("/nonexistent/workdir", 0, 1)
        self.assertEqual(stats["verifier_calls"], 0)
        self.assertEqual(stats["model_verifier_calls"], 0)


if __name__ == "__main__":
    unittest.main()
