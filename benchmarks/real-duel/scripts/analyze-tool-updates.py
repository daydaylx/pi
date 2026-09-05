#!/usr/bin/env python3
"""Aggregate size and redundancy of Pi ``tool_execution_update`` events.

The input is consumed line by line so large Real-Duel transcripts never need to
be loaded into memory. The JSON report contains only aggregate counts, hashes
and sizes; it deliberately never copies tool output into the repository.
"""

from __future__ import annotations

import argparse
import hashlib
import heapq
import json
from pathlib import Path
from typing import Any, Iterable

DEFAULT_TOP = 20
MAX_TOP = 1_000
MAX_TRACKED_HASHES = 50_000
MAX_TRACKED_CALLS = 10_000
MAX_TRACKED_TOOLS = 1_000


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def byte_length(value: str) -> int:
    return len(value.encode("utf-8"))


def update_events(path: Path) -> Iterable[tuple[int, dict[str, Any], int]]:
    """Yield valid update events with their one-based line and byte size."""
    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            stripped = line.strip()
            if not stripped:
                continue
            try:
                event = json.loads(stripped)
            except json.JSONDecodeError:
                continue
            if isinstance(event, dict) and event.get("type") == "tool_execution_update":
                yield line_number, event, byte_length(stripped)


def analyze(path: Path, top: int = DEFAULT_TOP) -> dict[str, Any]:
    """Return bounded, deterministic aggregate statistics for one transcript."""
    top = min(max(top, 1), MAX_TOP)
    by_tool: dict[str, dict[str, int]] = {}
    by_call: dict[str, dict[str, Any]] = {}
    seen_payload_hashes: set[str] = set()
    largest: list[tuple[int, int, str, str]] = []
    malformed = 0
    total_events = total_event_bytes = total_payload_bytes = 0
    identical_updates = near_identical_updates = 0
    repeated_payloads = 0
    hash_tracking_capped = call_tracking_capped = tool_tracking_capped = False
    untracked_tool_events = untracked_tool_event_bytes = untracked_tool_payload_bytes = 0

    for line_number, event, event_bytes in update_events(path):
        tool_name = event.get("toolName")
        tool_call_id = event.get("toolCallId")
        if not isinstance(tool_name, str) or not isinstance(tool_call_id, str):
            malformed += 1
            continue
        payload = event.get("partialResult")
        payload_text = canonical_json(payload)
        payload_bytes = byte_length(payload_text)
        payload_hash = hashlib.sha256(payload_text.encode("utf-8")).hexdigest()
        call = by_call.get(tool_call_id)
        if call is None and len(by_call) < MAX_TRACKED_CALLS:
            call = by_call[tool_call_id] = {
                "tool": tool_name,
                "events": 0,
                "event_bytes": 0,
                "payload_bytes": 0,
                "last_payload_hash": None,
                "last_payload_bytes": 0,
                "identical": 0,
                "near_identical": 0,
            }
        elif call is None:
            call_tracking_capped = True
        if call is not None:
            previous_hash = call["last_payload_hash"]
            previous_bytes = call["last_payload_bytes"]
            if isinstance(previous_hash, str):
                if payload_hash == previous_hash:
                    identical_updates += 1
                    call["identical"] += 1
                elif abs(payload_bytes - previous_bytes) <= 128:
                    near_identical_updates += 1
                    call["near_identical"] += 1
            call["last_payload_hash"] = payload_hash
            call["last_payload_bytes"] = payload_bytes
            call["events"] += 1
            call["event_bytes"] += event_bytes
            call["payload_bytes"] += payload_bytes
        if payload_hash in seen_payload_hashes:
            repeated_payloads += 1
        elif len(seen_payload_hashes) < MAX_TRACKED_HASHES:
            seen_payload_hashes.add(payload_hash)
        else:
            hash_tracking_capped = True
        tool = by_tool.get(tool_name)
        if tool is None and len(by_tool) < MAX_TRACKED_TOOLS:
            tool = by_tool[tool_name] = {
                "events": 0,
                "event_bytes": 0,
                "payload_bytes": 0,
            }
        if tool is None:
            tool_tracking_capped = True
            untracked_tool_events += 1
            untracked_tool_event_bytes += event_bytes
            untracked_tool_payload_bytes += payload_bytes
        else:
            tool["events"] += 1
            tool["event_bytes"] += event_bytes
            tool["payload_bytes"] += payload_bytes
        total_events += 1
        total_event_bytes += event_bytes
        total_payload_bytes += payload_bytes
        item = (event_bytes, line_number, tool_name, tool_call_id)
        if len(largest) < top:
            heapq.heappush(largest, item)
        elif item > largest[0]:
            heapq.heapreplace(largest, item)

    ranked_tools = sorted(
        ({"tool": tool, **stats} for tool, stats in by_tool.items()),
        key=lambda value: (-value["event_bytes"], value["tool"]),
    )
    ranked_calls = sorted(
        (
            {
                "tool_call_id": call_id,
                "tool": stats["tool"],
                "events": stats["events"],
                "event_bytes": stats["event_bytes"],
                "payload_bytes": stats["payload_bytes"],
                "identical_updates": stats["identical"],
                "snapshot_extensions": None,
                "near_identical_updates": stats["near_identical"],
            }
            for call_id, stats in by_call.items()
        ),
        key=lambda value: (-value["event_bytes"], value["tool_call_id"]),
    )
    return {
        "schema_version": 1,
        "transcript": str(path),
        "tool_execution_updates": {
            "events": total_events,
            "event_bytes": total_event_bytes,
            "payload_bytes": total_payload_bytes,
            "malformed_events": malformed,
            "repeated_payloads": repeated_payloads,
            "hash_tracking_capped": hash_tracking_capped,
            "tool_call_tracking_capped": call_tracking_capped,
            "tool_tracking_capped": tool_tracking_capped,
            "untracked_tool_events": untracked_tool_events,
            "untracked_tool_event_bytes": untracked_tool_event_bytes,
            "untracked_tool_payload_bytes": untracked_tool_payload_bytes,
            "consecutive_identical_updates": identical_updates,
            "consecutive_snapshot_extensions": None,
            "snapshot_extensions_measurable": False,
            "consecutive_near_identical_updates": near_identical_updates,
        },
        "largest_events": [
            {
                "event_bytes": event_bytes,
                "line": line_number,
                "tool": tool_name,
                "tool_call_id": tool_call_id,
            }
            for event_bytes, line_number, tool_name, tool_call_id in sorted(
                largest, reverse=True
            )
        ],
        "tools_by_event_bytes": ranked_tools[:top],
        "tool_calls_by_event_bytes": ranked_calls[:top],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("transcript", type=Path)
    parser.add_argument("--top", type=int, default=DEFAULT_TOP)
    args = parser.parse_args()
    if not 1 <= args.top <= MAX_TOP:
        parser.error(f"--top must be 1..{MAX_TOP}")
    print(json.dumps(analyze(args.transcript, args.top), indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
