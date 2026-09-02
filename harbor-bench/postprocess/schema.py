"""Benchmark v3 telemetry schema (Teil A5-A8, A1).

Harbor's own `AgentContext` (harbor.models.agent.context) only has
`n_input_tokens`, `n_cache_tokens`, `n_output_tokens`, `cost_usd`,
`rollout_details`, and a freeform `metadata: dict[str, Any] | None` -- there
is no typed field for reasoning tokens, cache-write tokens, phase timing,
tool-error categories, or subagent records. Everything defined here goes
into `context.metadata[TELEMETRY_NAMESPACE]`, under its own namespace and
its own schema version, independent of harbor's version, so a future Harbor
release adding its own `metadata` conventions cannot collide with it.
"""

from enum import StrEnum

from pydantic import BaseModel

TELEMETRY_NAMESPACE = "pi_bench_v3"
SCHEMA_VERSION = "1.0.0"


class PhaseTiming(BaseModel):
    started_at: str | None = None
    finished_at: str | None = None
    duration_ms: int | None = None


class RuntimeBreakdown(BaseModel):
    """A5: setup vs. agent time, separated. `source` records whether the
    sub-phase timestamps were self-instrumented in agent.py (Harbor's own
    `populate_context_post_run(context)` signature does not expose the
    top-level TrialResult phase timings, only the AgentContext) or derived
    from the agent's own NDJSON event stream."""

    container_setup_time: PhaseTiming = PhaseTiming()
    dependency_setup_time: PhaseTiming = PhaseTiming()
    agent_install_time: PhaseTiming = PhaseTiming()
    agent_startup_time: PhaseTiming = PhaseTiming()
    time_to_first_action: PhaseTiming = PhaseTiming()
    active_agent_time_ms: int | None = None
    idle_waiting_on_provider_ms: int | None = None
    source: str = "self_recorded"


class CostSource(StrEnum):
    provider_reported = "provider_reported"
    litellm_estimate = "litellm_estimate"
    pi_usage_cost_field = "pi_usage_cost_field"
    unavailable = "unavailable"


class TokenBreakdown(BaseModel):
    """A6. `input_fresh`/`input_cache_read` are Pi's own semantics (Pi's
    `n_input_tokens = input_fresh + input_cache_read`, kept unchanged in
    AgentContext's core field -- this class only ADDS the split, it does not
    redefine the core field). `total_context_exposure` is the harmonized
    sum of every token category below (fresh input + cache read + cache
    write + output + reasoning), a Benchmark-v3-only derived metric with no
    Harbor or provider equivalent."""

    input_fresh: int | None = None
    input_cache_read: int | None = None
    input_cache_write: int | None = None
    output: int | None = None
    reasoning: int | None = None
    provider_reported_total: int | None = None
    total_context_exposure: int | None = None
    cost_usd: float | None = None
    cost_source: CostSource = CostSource.unavailable


class ToolErrorCategory(StrEnum):
    """A7. `permission_denied_by_harness` is specifically for OUR OWN
    benchmark-infrastructure guard denials (Pi's fixed string "Aktion vom
    Benutzer abgelehnt.", see extensions/permissions/guards.ts), so those
    are visible separately from real agent/environment failures instead of
    being lumped into a single failedToolCalls count."""

    none = "none"
    test_failure = "test_failure"
    build_failure = "build_failure"
    syntax_error = "syntax_error"
    file_not_found = "file_not_found"
    permission_denied_by_harness = "permission_denied_by_harness"
    git_error = "git_error"
    network_error = "network_error"
    timeout = "timeout"
    tool_misuse = "tool_misuse"
    environment_error = "environment_error"
    unknown = "unknown"


class ToolCallRecord(BaseModel):
    tool_name: str
    is_error: bool
    category: ToolErrorCategory
    command_preview: str | None = None  # truncated to <=200 chars, no secrets


class ToolErrorSummary(BaseModel):
    total_tool_calls: int = 0
    total_failures: int = 0
    by_category: dict[str, int] = {}
    repeated_identical_failures: int | None = None
    records: list[ToolCallRecord] = []


class SubagentRecord(BaseModel):
    """A8. Portable of benchmarks/harness/p4/subagent-artifacts.mjs's
    `{runId}_{agent}_meta.json` parsing, extended to also read the
    previously-unused `_input.md`/`_output.md`/`_transcript.jsonl`
    artifacts (see docs/subagents.md) for delegated_instruction/
    child_result_summary and for reconstructing absolute spawn/completion
    timestamps instead of only a duration delta."""

    role: str
    model: str | None = None
    parent_run_id: str | None = None
    spawn_time: str | None = None
    completion_time: str | None = None
    duration_ms: int | None = None
    tokens: TokenBreakdown | None = None
    child_toolcalls: int | None = None
    delegated_instruction: str | None = None
    child_result_summary: str | None = None
    result_used_by_parent: bool | None = None
    parallel_execution: bool | None = None
    source: str = "pi_meta_json"


class SubagentTelemetry(BaseModel):
    records: list[SubagentRecord] = []
    # Set only on the Codex side: Harbor's built-in Codex adapter does not
    # populate ATIF's subagent_trajectories for Codex's own Collab
    # subagents (harbor-framework/harbor#1209, open). We do not attempt to
    # reconstruct that data ourselves -- see KNOWN_LIMITATIONS.md #1.
    codex_limitation_note: str | None = None


class VersionManifest(BaseModel):
    """A1/A9, mirrors MANIFEST.json (scripts/build_version_manifest.py) plus
    facts only known at run time (harbor's own version, the adapter's own
    name/version, Codex's pinned CLI version)."""

    harbor_version: str | None = None
    agent_adapter_name: str | None = None
    agent_adapter_version: str | None = None
    pi_cli_version: str | None = None
    pi_source_git_sha: str | None = None
    pi_source_dirty: bool | None = None
    pi_subagents_fork_sha: str | None = None
    node_version_pinned: str | None = None
    codex_cli_version: str | None = None
    codex_sandbox_flags: list[str] = []
    built_at: str | None = None


class TelemetryV3(BaseModel):
    schema_version: str = SCHEMA_VERSION
    runtime: RuntimeBreakdown = RuntimeBreakdown()
    tokens: TokenBreakdown = TokenBreakdown()
    subagent_tokens: TokenBreakdown | None = None
    tool_errors: ToolErrorSummary = ToolErrorSummary()
    subagents: SubagentTelemetry = SubagentTelemetry()
    versions: VersionManifest = VersionManifest()
    # Set when a source file needed for full extraction could not be parsed
    # (e.g. KNOWN_LIMITATIONS.md #5 -- Codex trajectory.json corrupted by a
    # host-side sandbox filter before any of our code sees it). The rest of
    # this TelemetryV3 is still a valid, if partial, best-effort result --
    # callers should surface this rather than silently scoring on zeros.
    degraded_reason: str | None = None
