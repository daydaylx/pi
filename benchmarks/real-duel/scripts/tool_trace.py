#!/usr/bin/env python3
"""Bounded Pi tool-call trace analysis for real-duel transcripts.

The raw transcript remains the source of truth. This module emits safe argument
summaries, fingerprints and aggregate timings; it never copies prompts, shell
commands or tool output into benchmark results.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from collections import Counter
from pathlib import Path, PurePath
from typing import Any, Iterable

SCHEMA_VERSION = 1
_MUTATING_TOOLS = {"edit", "write"}
_SEARCH_TOOLS = {"read", "grep", "find", "ls", "lsp_definition", "lsp_references", "lsp_hover", "lsp_workspace_symbols"}
_VERIFY_TOOLS = {"verify", "project_check"}


def _canonical(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def _fingerprint(value: Any) -> str:
    return hashlib.sha256(_canonical(value).encode("utf-8")).hexdigest()


def _iter_events(transcript_text: str) -> Iterable[dict[str, Any]]:
    for line in transcript_text.splitlines():
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(event, dict):
            yield event


def _result_text(result: Any) -> str:
    if not isinstance(result, dict):
        return ""
    content = result.get("content")
    if not isinstance(content, list):
        return ""
    return "\n".join(
        item.get("text", "")
        for item in content
        if isinstance(item, dict) and item.get("type") == "text"
    )


def classify_error(tool: str, text: str) -> str:
    """Classify only strong textual signals; ambiguous failures stay unknown."""
    lower = text.lower()
    if "harte projekt-, symlink- oder secret-grenze" in lower or "permission denied" in lower:
        return "permission"
    if "verifier-delegation abgelehnt" in lower or "schema" in lower or "ungültig" in lower:
        return "contract/schema"
    if "no module named" in lower or "cannot find module" in lower or "fehlende dependenc" in lower:
        return "dependency"
    if "no such file or directory" in lower or "nicht gefunden" in lower:
        return "path"
    if tool in _VERIFY_TOOLS and ("failed (exit-code" in lower or "pflichtabdeckung" in lower):
        return "verification"
    if "timeout" in lower or "timed out" in lower:
        return "tool/runtime"
    return "unknown"


def _tool_reported_duration_ms(text: str) -> int | None:
    match = re.search(
        r"Exit-Code\s+\d+,\s*([\d.,]+)\s*ms",
        text,
        re.IGNORECASE,
    )
    if not match:
        return None
    value = match.group(1)
    if re.fullmatch(r"\d{1,3}(?:[.,]\d{3})+", value):
        return int(value.replace(".", "").replace(",", ""))
    try:
        return round(float(value.replace(",", ".")))
    except ValueError:
        return None


def _error_summary(category: str, text: str) -> str:
    if category == "permission":
        return "Toolzugriff durch eine Projekt-/Symlink-/Secret-Grenze abgelehnt."
    if category == "contract/schema":
        return "Toolaufruf verletzte den geforderten Aufruf-/Übergabe-Contract."
    if category == "dependency":
        return "Erforderliche Laufzeitabhängigkeit fehlte."
    if category == "path":
        return "Ein angeforderter Pfad war nicht verfügbar."
    if category == "verification":
        return (
            "Verifikationslauf meldete Format-Drift."
            if "format drift" in text.lower()
            else "Eine Verifikationsprüfung schlug fehl."
        )
    if category == "tool/runtime":
        return "Der Toollauf überschritt ein Zeitlimit oder scheiterte zur Laufzeit."
    return "Nicht sicher klassifizierbar; Originalfehler bleibt im Rohtranskript."


def _safe_path(value: Any) -> Any:
    if not isinstance(value, str) or not value.startswith("/"):
        return value
    parts = PurePath(value).parts
    suffix = "/".join(parts[-2:]) if len(parts) >= 2 else ""
    return f"<absolute>/{suffix}"


def _safe_args(tool: str, args: dict[str, Any]) -> dict[str, Any]:
    """Retain useful invocation identity without copying free-form content."""
    if tool in {"read", "write", "edit"}:
        safe = {key: args[key] for key in ("path", "offset", "limit") if key in args}
        if "path" in safe:
            safe["path"] = _safe_path(safe["path"])
        return safe
    if tool == "subagent":
        return {key: args[key] for key in ("agent", "context", "outputMode") if key in args}
    if tool == "project_check":
        return {key: args[key] for key in ("profile", "profiles") if key in args}
    if tool == "verify":
        return {"check": args.get("check")}
    if tool == "recovery_check":
        return {}
    if tool == "bash":
        command = args.get("command", "")
        return {
            "command_sha256": hashlib.sha256(str(command).encode("utf-8")).hexdigest(),
            "timeout": args.get("timeout"),
        }
    safe: dict[str, Any] = {}
    for key in ("path", "line", "character", "includeDeclaration", "limit"):
        if key in args:
            safe[key] = _safe_path(args[key]) if key == "path" else args[key]
    if "query" in args:
        safe["query_sha256"] = hashlib.sha256(
            str(args["query"]).encode("utf-8")
        ).hexdigest()
    return safe


def _target_key(tool: str, args: dict[str, Any]) -> str:
    if tool in {"read", "write", "edit"}:
        target = args.get("path")
    elif tool == "subagent":
        target = args.get("agent")
    elif tool == "project_check":
        target = args.get("profile") or args.get("profiles")
    elif tool == "verify":
        target = args.get("check")
    elif tool == "bash":
        target = _fingerprint(args.get("command", ""))
    else:
        target = _safe_args(tool, args)
    return _fingerprint([tool, target])


def _refine_verification_category(
    category: str | None,
    tool: str,
    error_text: str,
    baseline_failures: dict[str, str] | None,
) -> str | None:
    """Refine a plain ``verification`` category using baseline knowledge (P2).

    A verification error whose baseline already failed the same check is
    ``verification/baseline`` (pre-existing, not the candidate's regression).
    A verification error arising against a clean baseline is
    ``verification/regression``. Without baseline context the category stays
    ``verification``. Matching is by check-name substring in the error text --
    a heuristic, never authoritative; the raw error stays recorded.
    """
    if category != "verification" or not baseline_failures:
        return category
    lower = error_text.lower()
    for check in baseline_failures:
        if not check:
            continue
        # Vollstaendiger Check-Name (z.B. "typecheck", "verify") oder das
        # Praefix vor dem Doppelpunkt ("format" aus "format:check"); der
        # Agent-Verify-Output nennt "FORMAT DRIFT", nicht "format:check",
        # darum stimmt das Praefix hier ueberein.
        keyword = check.split(":", 1)[0]
        if check.lower() in lower or keyword.lower() in lower:
            return "verification/baseline"
    return "verification/regression"


def _phase(tool: str, args: dict[str, Any]) -> str:
    if tool in _MUTATING_TOOLS:
        return "edit"
    if tool in _VERIFY_TOOLS:
        return "verification"
    if tool == "recovery_check":
        return "recovery"
    if tool == "subagent":
        return "verification" if args.get("agent") == "verifier" else "exploration"
    if tool in _SEARCH_TOOLS or tool.startswith("lsp_"):
        return "exploration"
    if tool == "bash":
        command = str(args.get("command", "")).lower()
        if re.search(r"\b(test|verify|check|lint|typecheck|pytest|unittest)\b", command):
            return "verification"
        if re.search(r"\b(rg|grep|find|ls|cat|head|tail|status|diff|log)\b", command):
            return "exploration"
    return "other"


def _union_ms(intervals: list[tuple[int, int]]) -> int:
    if not intervals:
        return 0
    merged: list[list[int]] = []
    for start, end in sorted(intervals):
        if not merged or start > merged[-1][1]:
            merged.append([start, end])
        else:
            merged[-1][1] = max(merged[-1][1], end)
    return sum(end - start for start, end in merged)


def analyze_pi_events(
    events: Iterable[dict[str, Any]],
    *,
    wall_time_s: float | None = None,
    checker_success: bool | None = None,
    checker_wall_time_s: float | None = None,
    baseline_failures: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Core tool-trace analysis over an iterable of already-parsed RPC events.

    Shared by Work-only (text transcript parsed by ``analyze_pi_trace``) and
    Plan->Work (disjoint Plan-/Work-phase event lists). Uses one and the same
    error classification, fingerprinting and privacy redaction -- there is no
    second trace implementation for Plan->Work.

    ``baseline_failures`` (P2) maps a failing baseline check name to its
    fingerprint; a verification error attributable to one of these checks is
    classified as ``verification/baseline`` (pre-existing) instead of a plain
    candidate regression. The raw error remains recorded; only the evaluation
    gets the additional class.
    """
    starts: dict[str, dict[str, Any]] = {}
    ends: dict[str, dict[str, Any]] = {}
    start_times: dict[str, int] = {}
    end_times: dict[str, int] = {}
    batch_sizes: dict[str, int] = {}
    transcript_start_ms: int | None = None

    for event in events:
        if event.get("type") == "tool_execution_start":
            call_id = event.get("toolCallId")
            if isinstance(call_id, str):
                starts[call_id] = event
        elif event.get("type") == "tool_execution_end":
            call_id = event.get("toolCallId")
            if isinstance(call_id, str):
                ends[call_id] = event
        elif event.get("type") == "message_end":
            message = event.get("message") or {}
            timestamp = message.get("timestamp")
            if isinstance(timestamp, int):
                transcript_start_ms = timestamp if transcript_start_ms is None else min(transcript_start_ms, timestamp)
            if message.get("role") == "assistant" and isinstance(timestamp, int):
                tool_calls = [
                    item for item in (message.get("content") or [])
                    if isinstance(item, dict) and item.get("type") == "toolCall" and isinstance(item.get("id"), str)
                ]
                for item in tool_calls:
                    start_times[item["id"]] = timestamp
                    batch_sizes[item["id"]] = len(tool_calls)
            elif message.get("role") == "toolResult" and isinstance(timestamp, int):
                call_id = message.get("toolCallId")
                if isinstance(call_id, str):
                    end_times[call_id] = timestamp

    if transcript_start_ms is None:
        transcript_start_ms = min(start_times.values(), default=0)

    calls: list[dict[str, Any]] = []
    mutation_generation = 0
    signatures_seen: Counter[str] = Counter()
    targets_seen: Counter[str] = Counter()
    verification_generation: dict[str, int] = {}

    for index, (call_id, start_event) in enumerate(starts.items(), start=1):
        tool = str(start_event.get("toolName") or "unknown")
        args = start_event.get("args") if isinstance(start_event.get("args"), dict) else {}
        end_event = ends.get(call_id, {})
        success = None if not end_event else not bool(end_event.get("isError"))
        signature = _fingerprint([tool, args])
        target = _target_key(tool, args)
        phase = _phase(tool, args)
        start_ms = start_times.get(call_id)
        end_ms = end_times.get(call_id)
        duration_ms = end_ms - start_ms if start_ms is not None and end_ms is not None else None
        error_text = _result_text(end_event.get("result")) if success is False else ""
        error_category = classify_error(tool, error_text) if success is False else None
        error_category = _refine_verification_category(
            error_category, tool, error_text, baseline_failures
        )
        repeated_verification = (
            phase == "verification"
            and signature in verification_generation
            and verification_generation[signature] == mutation_generation
        )
        call = {
            "index": index,
            "tool": tool,
            "arguments": _safe_args(tool, args),
            "argument_fingerprint": _fingerprint(args),
            "phase": phase,
            "start_offset_ms": start_ms - transcript_start_ms if start_ms is not None else None,
            "end_offset_ms": end_ms - transcript_start_ms if end_ms is not None else None,
            # Pi's tool_execution events carry no timestamps. This span starts
            # at the assistant-message timestamp and therefore includes model
            # preparation before the tool actually starts; it is not presented
            # as pure tool runtime.
            "observed_span_ms": duration_ms,
            "observed_span_basis": (
                "assistant-message-to-tool-result" if duration_ms is not None and batch_sizes.get(call_id) == 1
                else "parallel-assistant-message-to-results" if duration_ms is not None
                else "unavailable"
            ),
            "tool_reported_duration_ms": _tool_reported_duration_ms(error_text),
            "success": success,
            "error_category": error_category,
            "error_summary": _error_summary(error_category, error_text) if error_category else None,
            "error_fingerprint": _fingerprint(error_text) if error_text else None,
            "exact_duplicate": signatures_seen[signature] > 0,
            "repeated_target": targets_seen[target] > 0,
            "repeated_verification_without_mutation": repeated_verification,
            "retry": None,
            "_target": target,
        }
        calls.append(call)
        signatures_seen[signature] += 1
        targets_seen[target] += 1
        if phase == "verification":
            verification_generation[signature] = mutation_generation
        if tool in _MUTATING_TOOLS and success is True:
            mutation_generation += 1

    for position, call in enumerate(calls):
        if call["success"] is not False:
            continue
        later = [candidate for candidate in calls[position + 1 :] if candidate["_target"] == call["_target"]]
        if later:
            first_success = next((candidate for candidate in later if candidate["success"] is True), None)
            attempts = later[: later.index(first_success) + 1] if first_success else later
            call["retry"] = {
                "detected": True,
                "basis": "same-tool-target-later-in-transcript",
                "attempts": len(attempts),
                "eventual_success": first_success is not None,
                "success_call_index": first_success["index"] if first_success else None,
            }
        else:
            call["retry"] = {
                "detected": False,
                "basis": "no-same-tool-target-later-in-transcript",
                "attempts": 0,
                "eventual_success": False,
                "success_call_index": None,
            }

    phase_intervals: dict[str, list[tuple[int, int]]] = {}
    all_intervals: list[tuple[int, int]] = []
    for call in calls:
        if call["start_offset_ms"] is None or call["end_offset_ms"] is None:
            continue
        interval = (call["start_offset_ms"], call["end_offset_ms"])
        phase_intervals.setdefault(call["phase"], []).append(interval)
        all_intervals.append(interval)

    errors = [{key: value for key, value in call.items() if key != "_target"} for call in calls if call["success"] is False]
    public_calls = [{key: value for key, value in call.items() if key != "_target"} for call in calls]
    first_mutation = next((call for call in calls if call["tool"] in _MUTATING_TOOLS and call["success"] is True), None)
    first_successful_verification = next((call for call in calls if call["phase"] == "verification" and call["success"] is True), None)
    observed_tool_ms = _union_ms(all_intervals)
    wall_time_ms = round(wall_time_s * 1000) if wall_time_s is not None else None
    checker_wall_time_ms = round(checker_wall_time_s * 1000) if checker_wall_time_s is not None else None

    return {
        "schema_version": SCHEMA_VERSION,
        "summary": {
            "tool_calls": len(calls),
            "tool_errors": len(errors),
            "errors_by_category": dict(sorted(Counter(error["error_category"] for error in errors).items())),
            "exact_duplicate_calls": sum(call["exact_duplicate"] for call in calls),
            "repeated_target_calls": sum(call["repeated_target"] for call in calls),
            "repeated_verifications_without_mutation": sum(call["repeated_verification_without_mutation"] for call in calls),
            "phase_observed_span_ms": {phase: _union_ms(intervals) for phase, intervals in sorted(phase_intervals.items())},
            "observed_call_span_ms": observed_tool_ms,
            "wall_time_ms": wall_time_ms,
            "unattributed_wall_time_ms": max(0, wall_time_ms - observed_tool_ms) if wall_time_ms is not None else None,
            "time_to_first_mutation_ms": first_mutation["end_offset_ms"] if first_mutation else None,
            "time_to_first_successful_verification_ms": first_successful_verification["end_offset_ms"] if first_successful_verification else None,
            "time_to_first_valid_patch_ms": None,
            "first_valid_patch_status": "unavailable-without-snapshot-bound-checker",
            "first_confirmed_valid_patch_ms": (
                wall_time_ms + checker_wall_time_ms
                if checker_success is True
                and wall_time_ms is not None
                and checker_wall_time_ms is not None
                else None
            ),
            "checker_wall_time_ms": checker_wall_time_ms,
        },
        "errors": errors,
        "calls": public_calls,
    }


def analyze_pi_trace(
    transcript_text: str,
    *,
    wall_time_s: float | None = None,
    checker_success: bool | None = None,
    checker_wall_time_s: float | None = None,
    baseline_failures: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Analyse a Work-only ``pi --print`` JSONL transcript (text -> events).

    Thin wrapper around :func:`analyze_pi_events` so the text transcript and
    the Plan->Work event lists share one and the same core. Behaviour for
    Work-only is unchanged.
    """
    return analyze_pi_events(
        list(_iter_events(transcript_text)),
        wall_time_s=wall_time_s,
        checker_success=checker_success,
        checker_wall_time_s=checker_wall_time_s,
        baseline_failures=baseline_failures,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("transcript", type=Path)
    parser.add_argument("--wall-time-s", type=float)
    parser.add_argument("--checker-success", choices=("true", "false", "unknown"), default="unknown")
    parser.add_argument("--checker-wall-time-s", type=float)
    parser.add_argument(
        "--baseline-failure-check",
        action="append",
        default=[],
        help="Name eines bereits fehlgeschlagenen Baseline-Checks (wiederholbar); "
        "Verifikationsfehler, die denselben Check treffen, werden als "
        "verification/baseline statt als Regression klassifiziert.",
    )
    args = parser.parse_args()
    checker_success = {"true": True, "false": False, "unknown": None}[args.checker_success]
    baseline_failures = {check: "" for check in args.baseline_failure_check} or None
    result = analyze_pi_trace(
        args.transcript.read_text(encoding="utf-8"),
        wall_time_s=args.wall_time_s,
        checker_success=checker_success,
        checker_wall_time_s=args.checker_wall_time_s,
        baseline_failures=baseline_failures,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
