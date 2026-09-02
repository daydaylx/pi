"""A8: parses pi-subagents' `{runId}_{agent}_meta.json` artifacts (and the
previously-unused sibling `_input.md`/`_output.md`) into SubagentRecords.

Ported from benchmarks/harness/p4/subagent-artifacts.mjs, but reads `role`
and `parent_run_id` directly from the JSON's own `agent`/`runId` fields
(confirmed present in pi-subagents/src/runs/foreground/execution.ts's
`writeMetadata()` call) instead of parsing them out of the filename -- more
robust, and the real `usage` shape there is `{input, output, cacheRead,
cacheWrite, cost, turns}` (no `reasoning`, no `totalTokens`; P4's mjs
checked `usage.totalTokens`, which this schema never actually has).

Malformed metadata (no string `model` field) is skipped, never guessed --
same precedent as the P4 mjs.
"""

import json
from datetime import datetime, timezone
from pathlib import Path

from postprocess.schema import CostSource, SubagentRecord, TokenBreakdown

_TEXT_CAP = 2000  # delegated_instruction/child_result_summary truncation


def _ms_to_iso(ms: float | int | None) -> str | None:
    if ms is None:
        return None
    try:
        return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).isoformat()
    except (OverflowError, OSError, ValueError):
        return None


def _read_text_capped(path: Path) -> str | None:
    if not path.is_file():
        return None
    try:
        text = path.read_text(errors="replace")
    except OSError:
        return None
    return text if len(text) <= _TEXT_CAP else text[:_TEXT_CAP] + "…[truncated]"


def _mark_parallel_execution(records: list[SubagentRecord]) -> None:
    """Two records overlap iff their [spawn_time, completion_time] intervals
    intersect. O(n^2) is fine -- a single trial has at most a handful of
    subagent invocations."""
    spans: list[tuple[int, int, SubagentRecord]] = []
    for record in records:
        start = _iso_to_ms(record.spawn_time)
        end = _iso_to_ms(record.completion_time)
        if start is not None and end is not None:
            spans.append((start, end, record))

    for i, (start_a, end_a, record_a) in enumerate(spans):
        overlaps = any(
            j != i and start_a < end_b and start_b < end_a
            for j, (start_b, end_b, _) in enumerate(spans)
        )
        if overlaps:
            record_a.parallel_execution = True
        elif record_a.parallel_execution is None:
            record_a.parallel_execution = False


def _iso_to_ms(iso: str | None) -> int | None:
    if not iso:
        return None
    try:
        return int(datetime.fromisoformat(iso).timestamp() * 1000)
    except ValueError:
        return None


def parse_subagent_artifacts(artifacts_dir: Path) -> list[SubagentRecord]:
    if not artifacts_dir.is_dir():
        return []

    records: list[SubagentRecord] = []
    for meta_path in sorted(artifacts_dir.glob("*_meta.json")):
        try:
            meta = json.loads(meta_path.read_text())
        except (OSError, json.JSONDecodeError):
            continue
        if not isinstance(meta.get("model"), str):
            continue

        usage = meta.get("usage") or {}
        tokens = (
            TokenBreakdown(
                input_fresh=usage.get("input"),
                input_cache_read=usage.get("cacheRead"),
                input_cache_write=usage.get("cacheWrite"),
                output=usage.get("output"),
                cost_usd=usage.get("cost") or None,
                cost_source=(
                    CostSource.pi_usage_cost_field
                    if usage.get("cost")
                    else CostSource.unavailable
                ),
            )
            if usage
            else None
        )

        completion_ms = meta.get("timestamp")
        duration_ms = meta.get("durationMs")
        spawn_ms = (
            completion_ms - duration_ms
            if isinstance(completion_ms, int) and isinstance(duration_ms, (int, float))
            else None
        )

        base = meta_path.name[: -len("_meta.json")]
        input_md = artifacts_dir / f"{base}_input.md"
        output_md = artifacts_dir / f"{base}_output.md"

        records.append(
            SubagentRecord(
                role=meta.get("agent") or "unknown",
                model=meta.get("model"),
                parent_run_id=meta.get("runId"),
                spawn_time=_ms_to_iso(spawn_ms),
                completion_time=_ms_to_iso(completion_ms),
                duration_ms=int(duration_ms) if isinstance(duration_ms, (int, float)) else None,
                tokens=tokens,
                child_toolcalls=meta.get("toolCount"),
                delegated_instruction=_read_text_capped(input_md) or meta.get("task"),
                child_result_summary=_read_text_capped(output_md),
                result_used_by_parent=None,  # not derivable from artifacts alone -- not guessed
                parallel_execution=None,  # filled in below
                source="pi_meta_json",
            )
        )

    _mark_parallel_execution(records)
    return records
