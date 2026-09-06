#!/usr/bin/env python3
"""Regression tests for bounded Pi tool-trace analysis."""

from __future__ import annotations

import importlib.util
import json
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("tool_trace.py")
spec = importlib.util.spec_from_file_location("tool_trace", SCRIPT)
trace = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(trace)


def _events() -> str:
    events = [
        {"type": "message_end", "message": {"role": "user", "timestamp": 1_000, "content": []}},
        {"type": "message_end", "message": {"role": "assistant", "timestamp": 1_100, "content": [
            {"type": "toolCall", "id": "write-1", "name": "write"},
        ]}},
        {"type": "tool_execution_start", "toolCallId": "write-1", "toolName": "write", "args": {
            "path": "result.py", "content": "secret-free fixture",
        }},
        {"type": "tool_execution_end", "toolCallId": "write-1", "toolName": "write", "result": {
            "content": [{"type": "text", "text": "ok"}],
        }, "isError": False},
        {"type": "message_end", "message": {"role": "toolResult", "timestamp": 1_200,
            "toolCallId": "write-1", "toolName": "write", "isError": False}},
        {"type": "message_end", "message": {"role": "assistant", "timestamp": 1_300, "content": [
            {"type": "toolCall", "id": "read-1", "name": "read"},
        ]}},
        {"type": "tool_execution_start", "toolCallId": "read-1", "toolName": "read", "args": {
            "path": "/home/d/private/docs.md", "limit": 20,
        }},
        {"type": "tool_execution_end", "toolCallId": "read-1", "toolName": "read", "result": {
            "content": [{"type": "text", "text": "Harte Projekt-, Symlink- oder Secret-Grenze"}],
        }, "isError": True},
        {"type": "message_end", "message": {"role": "toolResult", "timestamp": 1_400,
            "toolCallId": "read-1", "toolName": "read", "isError": True}},
        {"type": "message_end", "message": {"role": "assistant", "timestamp": 1_500, "content": [
            {"type": "toolCall", "id": "read-2", "name": "read"},
        ]}},
        {"type": "tool_execution_start", "toolCallId": "read-2", "toolName": "read", "args": {
            "path": "/home/d/private/docs.md", "limit": 40,
        }},
        {"type": "tool_execution_end", "toolCallId": "read-2", "toolName": "read", "result": {
            "content": [{"type": "text", "text": "Harte Projekt-, Symlink- oder Secret-Grenze"}],
        }, "isError": True},
        {"type": "message_end", "message": {"role": "toolResult", "timestamp": 1_600,
            "toolCallId": "read-2", "toolName": "read", "isError": True}},
        {"type": "message_end", "message": {"role": "assistant", "timestamp": 1_700, "content": [
            {"type": "toolCall", "id": "verify-1", "name": "project_check"},
        ]}},
        {"type": "tool_execution_start", "toolCallId": "verify-1", "toolName": "project_check", "args": {
            "profile": "verify",
        }},
        {"type": "tool_execution_end", "toolCallId": "verify-1", "toolName": "project_check", "result": {
            "content": [{"type": "text", "text": "verify [required]: failed (Exit-Code 1, 68.775 ms)\nFORMAT DRIFT: gui.css"}],
        }, "isError": True},
        {"type": "message_end", "message": {"role": "toolResult", "timestamp": 1_900,
            "toolCallId": "verify-1", "toolName": "project_check", "isError": True}},
        {"type": "message_end", "message": {"role": "assistant", "timestamp": 2_000, "content": [
            {"type": "toolCall", "id": "sub-1", "name": "subagent"},
        ]}},
        {"type": "tool_execution_start", "toolCallId": "sub-1", "toolName": "subagent", "args": {
            "agent": "verifier", "task": "large prompt that must not be copied",
        }},
        {"type": "tool_execution_end", "toolCallId": "sub-1", "toolName": "subagent", "result": {
            "content": [{"type": "text", "text": "Verifier-Delegation abgelehnt: unvollständiger Prüfauftrag"}],
        }, "isError": True},
        {"type": "message_end", "message": {"role": "toolResult", "timestamp": 2_100,
            "toolCallId": "sub-1", "toolName": "subagent", "isError": True}},
        {"type": "message_end", "message": {"role": "assistant", "timestamp": 2_200, "content": [
            {"type": "toolCall", "id": "sub-2", "name": "subagent"},
        ]}},
        {"type": "tool_execution_start", "toolCallId": "sub-2", "toolName": "subagent", "args": {
            "agent": "verifier", "task": "corrected prompt still not persisted",
        }},
        {"type": "tool_execution_end", "toolCallId": "sub-2", "toolName": "subagent", "result": {
            "content": [{"type": "text", "text": "Verifier-Delegation abgelehnt: schema mismatch"}],
        }, "isError": True},
        {"type": "message_end", "message": {"role": "toolResult", "timestamp": 2_300,
            "toolCallId": "sub-2", "toolName": "subagent", "isError": True}},
        {"type": "message_end", "message": {"role": "assistant", "timestamp": 2_400, "content": [
            {"type": "toolCall", "id": "sub-3", "name": "subagent"},
        ]}},
        {"type": "tool_execution_start", "toolCallId": "sub-3", "toolName": "subagent", "args": {
            "agent": "verifier", "task": "accepted prompt",
        }},
        {"type": "tool_execution_end", "toolCallId": "sub-3", "toolName": "subagent", "result": {
            "content": [{"type": "text", "text": "PASS"}],
        }, "isError": False},
        {"type": "message_end", "message": {"role": "toolResult", "timestamp": 2_600,
            "toolCallId": "sub-3", "toolName": "subagent", "isError": False}},
    ]
    return "\n".join(json.dumps(event, ensure_ascii=False) for event in events)


class ToolTraceTest(unittest.TestCase):
    def test_errors_are_classified_and_retries_are_linked(self) -> None:
        result = trace.analyze_pi_trace(_events(), wall_time_s=2.0)

        self.assertEqual(result["summary"]["tool_errors"], 5)
        self.assertEqual(result["summary"]["errors_by_category"], {
            "contract/schema": 2,
            "permission": 2,
            "verification": 1,
        })
        read_errors = [error for error in result["errors"] if error["tool"] == "read"]
        self.assertTrue(read_errors[0]["retry"]["detected"])
        self.assertFalse(read_errors[0]["retry"]["eventual_success"])
        verifier_errors = [error for error in result["errors"] if error["tool"] == "subagent"]
        self.assertTrue(verifier_errors[0]["retry"]["eventual_success"])
        self.assertEqual(verifier_errors[0]["retry"]["success_call_index"], 7)

    def test_trace_marks_repeated_targets_without_copying_free_text(self) -> None:
        result = trace.analyze_pi_trace(_events())

        self.assertEqual(result["summary"]["exact_duplicate_calls"], 0)
        self.assertEqual(result["summary"]["repeated_target_calls"], 3)
        self.assertNotIn("task", result["calls"][4]["arguments"])
        self.assertNotIn("content", result["calls"][0]["arguments"])
        self.assertEqual(
            result["calls"][1]["arguments"]["path"],
            "<absolute>/private/docs.md",
        )
        self.assertEqual(
            result["calls"][3]["error_summary"],
            "Verifikationslauf meldete Format-Drift.",
        )
        serialized = json.dumps(result, ensure_ascii=False)
        for raw_text in (
            "secret-free fixture",
            "large prompt that must not be copied",
            "gui.css",
            "/home/d",
        ):
            self.assertNotIn(raw_text, serialized)
        safe_query = trace._safe_args(
            "lsp_workspace_symbols", {"query": "private symbol name"}
        )
        self.assertNotIn("query", safe_query)
        self.assertIn("query_sha256", safe_query)

    def test_timing_is_observed_but_first_valid_patch_is_not_invented(self) -> None:
        result = trace.analyze_pi_trace(
            _events(),
            wall_time_s=2.0,
            checker_success=True,
            checker_wall_time_s=0.25,
        )
        summary = result["summary"]

        self.assertEqual(summary["time_to_first_mutation_ms"], 200)
        self.assertEqual(summary["time_to_first_successful_verification_ms"], 1_600)
        self.assertIsNone(summary["time_to_first_valid_patch_ms"])
        self.assertEqual(summary["first_confirmed_valid_patch_ms"], 2_250)
        self.assertEqual(result["errors"][2]["tool_reported_duration_ms"], 68_775)
        without_checker_timing = trace.analyze_pi_trace(
            _events(), wall_time_s=2.0, checker_success=True
        )
        self.assertIsNone(
            without_checker_timing["summary"]["first_confirmed_valid_patch_ms"]
        )
        self.assertEqual(summary["first_valid_patch_status"], "unavailable-without-snapshot-bound-checker")
        self.assertEqual(summary["phase_observed_span_ms"], {
            "edit": 100,
            "exploration": 200,
            "verification": 600,
        })


class ToolTraceEventsTest(unittest.TestCase):
    """P1: analyze_pi_events ueber disjunkte Plan-/Work-Event-Listen."""

    @staticmethod
    def _plan_events() -> list[dict]:
        # Planphase: ein erfolgreicher write-Call + ein fehlerhafter read-Call
        # (Retry-Kandidat, spaeter in der Workphase erfolgreich).
        return [
            {"type": "message_end", "message": {"role": "user", "timestamp": 1_000, "content": []}},
            {"type": "message_end", "message": {"role": "assistant", "timestamp": 1_100, "content": [
                {"type": "toolCall", "id": "plan-write", "name": "write"},
            ]}},
            {"type": "tool_execution_start", "toolCallId": "plan-write", "toolName": "write", "args": {
                "path": "plan.md", "content": "should-not-leak",
            }},
            {"type": "tool_execution_end", "toolCallId": "plan-write", "toolName": "write", "result": {
                "content": [{"type": "text", "text": "ok"}],
            }, "isError": False},
            {"type": "message_end", "message": {"role": "toolResult", "timestamp": 1_200,
                "toolCallId": "plan-write", "toolName": "write", "isError": False}},
            {"type": "message_end", "message": {"role": "assistant", "timestamp": 1_300, "content": [
                {"type": "toolCall", "id": "plan-read", "name": "read"},
            ]}},
            {"type": "tool_execution_start", "toolCallId": "plan-read", "toolName": "read", "args": {
                "path": "/home/d/secret/plan.txt", "limit": 10,
            }},
            {"type": "tool_execution_end", "toolCallId": "plan-read", "toolName": "read", "result": {
                "content": [{"type": "text", "text": "Harte Projekt-, Symlink- oder Secret-Grenze"}],
            }, "isError": True},
            {"type": "message_end", "message": {"role": "toolResult", "timestamp": 1_400,
                "toolCallId": "plan-read", "toolName": "read", "isError": True}},
        ]

    @staticmethod
    def _work_events() -> list[dict]:
        # Workphase: eigener erfolgreicher read-Call desselben Ziels (Retry-
        # Erfolg fuer den Plan-Read) + ein eigener project_check-Fehler.
        return [
            {"type": "message_end", "message": {"role": "assistant", "timestamp": 2_000, "content": [
                {"type": "toolCall", "id": "work-read", "name": "read"},
            ]}},
            {"type": "tool_execution_start", "toolCallId": "work-read", "toolName": "read", "args": {
                "path": "/home/d/secret/plan.txt", "limit": 20,
            }},
            {"type": "tool_execution_end", "toolCallId": "work-read", "toolName": "read", "result": {
                "content": [{"type": "text", "text": "plan content"}],
            }, "isError": False},
            {"type": "message_end", "message": {"role": "toolResult", "timestamp": 2_100,
                "toolCallId": "work-read", "toolName": "read", "isError": False}},
            {"type": "message_end", "message": {"role": "assistant", "timestamp": 2_200, "content": [
                {"type": "toolCall", "id": "work-verify", "name": "project_check"},
            ]}},
            {"type": "tool_execution_start", "toolCallId": "work-verify", "toolName": "project_check", "args": {
                "profile": "verify",
            }},
            {"type": "tool_execution_end", "toolCallId": "work-verify", "toolName": "project_check", "result": {
                "content": [{"type": "text", "text": "verify [required]: failed (Exit-Code 1, 12.000 ms)\nFORMAT DRIFT: gui.css"}],
            }, "isError": True},
            {"type": "message_end", "message": {"role": "toolResult", "timestamp": 2_400,
                "toolCallId": "work-verify", "toolName": "project_check", "isError": True}},
        ]

    def test_phase_separation_no_double_count(self) -> None:
        plan = self._plan_events()
        work = self._work_events()
        plan_trace = trace.analyze_pi_events(plan, wall_time_s=1.0)
        work_trace = trace.analyze_pi_events(work, wall_time_s=1.0)
        total = trace.analyze_pi_events(plan + work, wall_time_s=2.0)

        # Planphase: 2 Calls (write + read), 1 Fehler (read).
        self.assertEqual(plan_trace["summary"]["tool_calls"], 2)
        self.assertEqual(plan_trace["summary"]["tool_errors"], 1)
        # Workphase: 2 Calls (read + verify), 1 Fehler (verify).
        self.assertEqual(work_trace["summary"]["tool_calls"], 2)
        self.assertEqual(work_trace["summary"]["tool_errors"], 1)
        # Gesamt = Summe, keine Doppelzaehlung (disjunkte call_ids).
        self.assertEqual(total["summary"]["tool_calls"], 4)
        self.assertEqual(total["summary"]["tool_errors"], 2)
        self.assertEqual(
            total["summary"]["tool_calls"],
            plan_trace["summary"]["tool_calls"] + work_trace["summary"]["tool_calls"],
        )
        self.assertEqual(
            total["summary"]["tool_errors"],
            plan_trace["summary"]["tool_errors"] + work_trace["summary"]["tool_errors"],
        )
        # Retry ueber die Phasengrenze nur im Gesamt-Trace sichtbar: der
        # fehlerhafte Plan-Read wird spaeter im Work-Trace erfolgreich
        # wiederholt.
        plan_read_error = next(
            e for e in plan_trace["errors"] if e["tool"] == "read"
        )
        self.assertFalse(plan_read_error["retry"]["eventual_success"])
        total_read_error = next(
            e for e in total["errors"] if e["tool"] == "read" and e["index"] == 2
        )
        self.assertTrue(total_read_error["retry"]["eventual_success"])
        self.assertEqual(total_read_error["retry"]["success_call_index"], 3)

    def test_analyze_pi_events_privacy_redaction(self) -> None:
        total = trace.analyze_pi_events(self._plan_events() + self._work_events())
        serialized = json.dumps(total, ensure_ascii=False)
        # Keine freien Texte, Write-Inhalte, Shell-Befehle oder absoluten
        # /home/d/-Praefixe duerfen in den Sidecar gelangen (gleicher strenger
        # Datenschutz wie Work-only).
        for raw in ("should-not-leak", "plan content", "gui.css", "/home/d/"):
            self.assertNotIn(raw, serialized)
        # Absoluter Pfad nur als redigiertes <absolute>/suffix.
        read_call = next(c for c in total["calls"] if c["tool"] == "read")
        self.assertEqual(read_call["arguments"]["path"], "<absolute>/secret/plan.txt")

    def test_baseline_classification_refines_verification(self) -> None:
        # P2: ein project_check-Fehler gegen eine Baseline, die denselben Check
        # schon vor dem Kandidaten enthielt, wird zu verification/baseline.
        baseline = {"format:check": "deadbeef"}
        total = trace.analyze_pi_events(
            self._plan_events() + self._work_events(),
            baseline_failures=baseline,
        )
        verify_error = next(
            e for e in total["errors"] if e["tool"] == "project_check"
        )
        self.assertEqual(verify_error["error_category"], "verification/baseline")
        # Ohne Baseline-Kontext bleibt es eine plain regression / verification.
        no_baseline = trace.analyze_pi_events(self._plan_events() + self._work_events())
        verify_error2 = next(
            e for e in no_baseline["errors"] if e["tool"] == "project_check"
        )
        self.assertEqual(verify_error2["error_category"], "verification")


if __name__ == "__main__":
    unittest.main()
