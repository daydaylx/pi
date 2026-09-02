"""A5/A6/A7/A8 (Pi side): builds a TelemetryV3 from a completed trial's
pi.txt NDJSON log plus self-instrumented phase timestamps from agent.py.

Empirically verified field relationship (2026-09-01, against real
gate-a3-pi/gate-a2-pi-3 runs -- see TELEMETRY_SCHEMA.md): Pi's
`usage.totalTokens == usage.input + usage.output + usage.cacheRead +
usage.cacheWrite` in every observed event. `usage.reasoning` is NOT additive
into totalTokens -- it is a sub-count already included inside `output`
(OpenAI-style reasoning-tokens-within-output-tokens accounting), not a
separate bucket. Do not add it again when computing totals.
"""

import json
from datetime import datetime, timezone
from pathlib import Path

from postprocess.schema import (
    CostSource,
    PhaseTiming,
    RuntimeBreakdown,
    SubagentTelemetry,
    TelemetryV3,
    TokenBreakdown,
    ToolErrorSummary,
    VersionManifest,
)
from postprocess.subagents import parse_subagent_artifacts
from postprocess.tool_errors import summarize


def _iso_to_ms(iso: str | None) -> int | None:
    if not iso:
        return None
    try:
        return int(datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp() * 1000)
    except ValueError:
        return None


def _phase(start_iso: str | None, end_iso: str | None) -> PhaseTiming:
    start_ms = _iso_to_ms(start_iso)
    end_ms = _iso_to_ms(end_iso)
    duration = end_ms - start_ms if start_ms is not None and end_ms is not None else None
    return PhaseTiming(started_at=start_iso, finished_at=end_iso, duration_ms=duration)


def _iter_events(pi_txt_path: Path):
    for line in pi_txt_path.read_text(errors="replace").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            yield json.loads(line)
        except (json.JSONDecodeError, TypeError):
            continue


def _extract_tokens(events: list[dict]) -> TokenBreakdown:
    input_fresh = 0
    cache_read = 0
    cache_write = 0
    output = 0
    reasoning = 0
    total_reported: int | None = None
    total_cost = 0.0
    saw_usage = False

    for event in events:
        if event.get("type") != "message_end":
            continue
        message = event.get("message") or {}
        if message.get("role") != "assistant":
            continue
        usage = message.get("usage") or {}
        if not usage:
            continue
        saw_usage = True
        input_fresh += usage.get("input", 0) or 0
        output += usage.get("output", 0) or 0
        cache_read += usage.get("cacheRead", 0) or 0
        cache_write += usage.get("cacheWrite", 0) or 0
        reasoning += usage.get("reasoning", 0) or 0
        if "totalTokens" in usage:
            total_reported = (total_reported or 0) + usage["totalTokens"]
        cost = usage.get("cost") or {}
        total_cost += cost.get("total", 0.0) or 0.0

    if not saw_usage:
        return TokenBreakdown()

    # See module docstring: totalTokens already == input+output+cacheRead+
    # cacheWrite; reasoning is a sub-count of output, not additive.
    total_context_exposure = total_reported if total_reported is not None else (
        input_fresh + output + cache_read + cache_write
    )

    return TokenBreakdown(
        input_fresh=input_fresh,
        input_cache_read=cache_read,
        input_cache_write=cache_write,
        output=output,
        reasoning=reasoning,
        provider_reported_total=total_reported,
        total_context_exposure=total_context_exposure,
        cost_usd=total_cost if total_cost > 0 else None,
        cost_source=CostSource.pi_usage_cost_field if total_cost > 0 else CostSource.unavailable,
    )


def _extract_tool_calls(events: list[dict]) -> list[tuple[str, bool, str]]:
    """(tool_name, is_error, result_text) from tool_execution_end events --
    these carry toolName/isError directly, unlike the inline copies in
    message_end's assistant content (which exist too but are a strict
    subset of the same information)."""
    calls: list[tuple[str, bool, str]] = []
    for event in events:
        if event.get("type") != "tool_execution_end":
            continue
        tool_name = event.get("toolName", "unknown")
        is_error = bool(event.get("isError", False))
        result = event.get("result") or {}
        text_parts = [
            c.get("text", "") for c in (result.get("content") or []) if c.get("type") == "text"
        ]
        calls.append((tool_name, is_error, "\n".join(text_parts)))
    return calls


def _session_timestamp(events: list[dict]) -> str | None:
    for event in events:
        if event.get("type") == "session":
            return event.get("timestamp")
    return None


def _first_tool_call_ms(events: list[dict]) -> int | None:
    for event in events:
        if event.get("type") != "message_end":
            continue
        message = event.get("message") or {}
        if message.get("role") != "assistant":
            continue
        has_tool_call = any(item.get("type") == "toolCall" for item in message.get("content") or [])
        if has_tool_call and isinstance(message.get("timestamp"), int):
            return message["timestamp"]
    return None


def _active_agent_time_ms(events: list[dict]) -> int | None:
    """Sum of (toolResult.timestamp - enclosing assistant message timestamp)
    per tool call, matched by call id. Individual `toolCall` content items
    carry no timestamp of their own (verified: only `type`/`id`/`name`/
    `arguments`) -- the enclosing assistant `message_end` event's single
    top-level `timestamp` is shared by every toolCall it emitted (the point
    generation finished and dispatch began); `toolResult`-role message_end
    events carry their own `timestamp` (completion) plus `toolCallId`."""
    call_ts: dict[str, int] = {}
    total_ms = 0
    found_any = False
    for event in events:
        if event.get("type") != "message_end":
            continue
        message = event.get("message") or {}
        if message.get("role") == "assistant" and isinstance(message.get("timestamp"), int):
            for item in message.get("content") or []:
                if item.get("type") == "toolCall" and item.get("id"):
                    call_ts[item["id"]] = message["timestamp"]
        elif message.get("role") == "toolResult":
            call_id = message.get("toolCallId")
            ts = message.get("timestamp")
            if call_id in call_ts and isinstance(ts, int):
                total_ms += max(0, ts - call_ts[call_id])
                found_any = True
    return total_ms if found_any else None


def build_pi_telemetry(
    pi_txt_path: Path,
    *,
    phase_timestamps: dict[str, tuple[str | None, str | None]] | None = None,
    process_started_at: str | None = None,
    version_manifest: dict | None = None,
    harbor_version: str | None = None,
    adapter_name: str | None = None,
    adapter_version: str | None = None,
    subagent_artifacts_dir: Path | None = None,
) -> TelemetryV3:
    phase_timestamps = phase_timestamps or {}
    events = list(_iter_events(pi_txt_path)) if pi_txt_path.exists() else []

    session_ts = _session_timestamp(events)
    first_tool_ms = _first_tool_call_ms(events)
    first_tool_iso = (
        datetime.fromtimestamp(first_tool_ms / 1000, tz=timezone.utc).isoformat()
        if first_tool_ms is not None
        else None
    )

    runtime = RuntimeBreakdown(
        container_setup_time=_phase(*phase_timestamps.get("container_setup_time", (None, None))),
        dependency_setup_time=_phase(*phase_timestamps.get("dependency_setup_time", (None, None))),
        agent_install_time=_phase(*phase_timestamps.get("agent_install_time", (None, None))),
        agent_startup_time=_phase(process_started_at, session_ts),
        time_to_first_action=_phase(session_ts, first_tool_iso),
        active_agent_time_ms=_active_agent_time_ms(events),
        idle_waiting_on_provider_ms=None,  # not derivable from available data -- not guessed
        source="ndjson_derived" if events else "self_recorded",
    )

    tokens = _extract_tokens(events)
    tool_errors: ToolErrorSummary = summarize(_extract_tool_calls(events))

    subagents = SubagentTelemetry(
        records=parse_subagent_artifacts(subagent_artifacts_dir) if subagent_artifacts_dir else []
    )

    manifest = version_manifest or {}
    versions = VersionManifest(
        harbor_version=harbor_version,
        agent_adapter_name=adapter_name,
        agent_adapter_version=adapter_version,
        pi_cli_version=manifest.get("pi_cli_version"),
        pi_source_git_sha=manifest.get("pi_source_git_sha"),
        pi_source_dirty=manifest.get("pi_source_dirty"),
        pi_subagents_fork_sha=manifest.get("pi_subagents_fork_sha"),
        node_version_pinned=manifest.get("node_version_pinned"),
        built_at=manifest.get("built_at"),
    )

    return TelemetryV3(
        runtime=runtime,
        tokens=tokens,
        tool_errors=tool_errors,
        subagents=subagents,
        versions=versions,
    )
