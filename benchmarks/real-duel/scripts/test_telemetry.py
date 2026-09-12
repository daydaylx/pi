#!/usr/bin/env python3
"""Small regression fixtures for Pi usage/event accounting."""

from __future__ import annotations

import importlib.util
import json
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


if __name__ == "__main__":
    unittest.main()
