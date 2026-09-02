"""A6/A7 (Codex side): builds TelemetryV3 fields from Harbor's own ATIF
`trajectory.json`, produced natively by harbor.agents.installed.codex:Codex.

Field provenance verified against the Codex adapter source
(harbor/agents/installed/codex.py), NOT against a live trajectory.json
re-read host-side in this interactive session (its sandbox rewrites
digit-heavy content in such files with the literal text "[REDACTED]" at
the byte level -- confirmed via a bare Path.read_bytes() in a fresh python3
subprocess, not just this module's own Read/Bash tool calls, so it is not
a display-layer artifact of any one tool. Whether Harbor's own in-container
processing of the same file, during the actual trial run, hits the same
filter is unknown and untested -- that path never goes through this
session's Bash tool. See KNOWN_LIMITATIONS.md #5 for the full account and
the graceful-degradation fallback below):

- Per-step `Metrics.extra`: `{"reasoning_output_tokens", "total_tokens",
  "cache_write_input_tokens"?}`; core fields `prompt_tokens`,
  `completion_tokens`, `cached_tokens` (codex.py:515-543).
- `FinalMetrics.extra`: same three keys, `total_` prefixed
  (codex.py:1123-1131). `total_cost_usd` falls back to a LiteLLM price-table
  estimate whenever Codex's own rollout doesn't report a real cost
  (codex.py:1117-1120, comment: "Codex CLI does not include cost in
  token_count events"). **Known, accepted limitation**: the ATIF output does
  not preserve which of the two applied for a given run -- `cost_source` is
  therefore always reported as `litellm_estimate` when a cost value is
  present, not because it necessarily IS an estimate, but because we cannot
  tell from this file alone. See TELEMETRY_SCHEMA.md.
- Each `tool_call` step's `Observation.results[].extra["status"]` carries
  the raw Codex rollout item's own status string (codex.py:619-622,
  ultimately `payload.get("status")` from Codex's own JSON), used the same
  way `isError` is used on the Pi side.
"""

import json
from pathlib import Path
from typing import Any

from harbor.models.trajectories.trajectory import Trajectory

from postprocess.schema import (
    CostSource,
    RuntimeBreakdown,
    SubagentTelemetry,
    TelemetryV3,
    TokenBreakdown,
    VersionManifest,
)
from postprocess.tool_errors import summarize

_CODEX_SUBAGENT_LIMITATION = (
    "Harbor's built-in Codex adapter (as of harbor==0.22.0) does not populate "
    "ATIF's subagent_trajectories for Codex's own internal Collab subagents "
    "(harbor-framework/harbor#1209, open; PR #970, open). Not reconstructed "
    "here -- see KNOWN_LIMITATIONS.md #1."
)


def _extract_tokens(trajectory: Trajectory) -> TokenBreakdown:
    final = trajectory.final_metrics
    if final is None:
        return TokenBreakdown()

    extra = final.extra or {}
    reasoning = extra.get("reasoning_output_tokens")
    total_reported = extra.get("total_tokens")
    cache_write = extra.get("total_cache_write_input_tokens")

    cache_read = final.total_cached_tokens or 0
    # ATIF's total_prompt_tokens is defined as "including cached tokens"
    # (harbor/models/trajectories/final_metrics.py) -- subtract cache_read to
    # get the fresh-only figure, matching Pi's input_fresh semantics.
    prompt_total = final.total_prompt_tokens or 0
    input_fresh = max(0, prompt_total - cache_read)

    cost = final.total_cost_usd
    return TokenBreakdown(
        input_fresh=input_fresh,
        input_cache_read=cache_read,
        input_cache_write=cache_write,
        output=final.total_completion_tokens,
        reasoning=reasoning,
        provider_reported_total=total_reported,
        total_context_exposure=total_reported
        if total_reported is not None
        else (input_fresh + cache_read + (cache_write or 0) + (final.total_completion_tokens or 0)),
        cost_usd=cost,
        # See module docstring: ATIF does not preserve provenance, so any
        # present cost is labeled as the (common-case) estimate, not claimed
        # as a confirmed provider-reported value.
        cost_source=CostSource.litellm_estimate if cost is not None else CostSource.unavailable,
    )


def _extract_tool_calls(trajectory: Trajectory) -> list[tuple[str, bool, str]]:
    calls: list[tuple[str, bool, str]] = []
    for step in trajectory.steps:
        if not step.tool_calls:
            continue
        for tool_call in step.tool_calls:
            text = ""
            is_error = False
            if step.observation:
                for result in step.observation.results:
                    if result.source_call_id != tool_call.tool_call_id:
                        continue
                    content = result.content
                    text = content if isinstance(content, str) else str(content or "")
                    status = (result.extra or {}).get("status")
                    if isinstance(status, str) and status not in ("completed", "success"):
                        is_error = True
                    break
            calls.append((tool_call.function_name, is_error, text))
    return calls


def build_codex_telemetry(
    trajectory_path: Path,
    *,
    harbor_version: str | None = None,
    codex_cli_version: str | None = None,
) -> TelemetryV3:
    if not trajectory_path.exists():
        return TelemetryV3(
            subagents=SubagentTelemetry(codex_limitation_note=_CODEX_SUBAGENT_LIMITATION),
            versions=VersionManifest(
                harbor_version=harbor_version,
                agent_adapter_name="codex",
                codex_cli_version=codex_cli_version,
                codex_sandbox_flags=[
                    "--dangerously-bypass-approvals-and-sandbox",
                    "--skip-git-repo-check",
                ],
            ),
        )

    try:
        raw: dict[str, Any] = json.loads(trajectory_path.read_text())
    except json.JSONDecodeError as exc:
        # Empirically confirmed (2026-09-01, see KNOWN_LIMITATIONS.md #5):
        # this session's sandbox rewrites digit-heavy substrings (commit
        # hashes, timestamps, step_ids) in files read by ANY process this
        # session spawns -- verified via a raw Path.read_bytes() in a bare
        # `python3` subprocess, not just this module's own Read/Bash tool
        # calls, and not just terminal display. Corrects this module's
        # earlier (unverified) docstring claim that a real Python file read
        # was unaffected. Whether Harbor's own in-container pipeline hits
        # the same filter is still unknown -- only host-side re-reads via
        # this session have been tested. Degrade gracefully rather than
        # crash the whole postprocessing run over one corrupted file.
        return TelemetryV3(
            subagents=SubagentTelemetry(codex_limitation_note=_CODEX_SUBAGENT_LIMITATION),
            versions=VersionManifest(
                harbor_version=harbor_version,
                agent_adapter_name="codex",
                codex_cli_version=codex_cli_version,
                codex_sandbox_flags=[
                    "--dangerously-bypass-approvals-and-sandbox",
                    "--skip-git-repo-check",
                ],
            ),
            degraded_reason=(
                f"trajectory.json at {trajectory_path} failed json.loads() "
                f"({exc}) -- see KNOWN_LIMITATIONS.md #5. Fields below are "
                "defaults, not measured zeros."
            ),
        )
    trajectory = Trajectory.model_validate(raw)

    return TelemetryV3(
        runtime=RuntimeBreakdown(source="ndjson_derived"),  # no phase-timing source available
        tokens=_extract_tokens(trajectory),
        tool_errors=summarize(_extract_tool_calls(trajectory)),
        subagents=SubagentTelemetry(codex_limitation_note=_CODEX_SUBAGENT_LIMITATION),
        versions=VersionManifest(
            harbor_version=harbor_version,
            agent_adapter_name="codex",
            codex_cli_version=codex_cli_version,
            codex_sandbox_flags=[
                "--dangerously-bypass-approvals-and-sandbox",
                "--skip-git-repo-check",
            ],
        ),
    )
