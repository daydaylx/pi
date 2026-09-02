# TELEMETRY_SCHEMA.md — Benchmark v3 (A5-A8)

Defines `harbor-bench/postprocess/schema.py::TelemetryV3`, stored per trial
at `agent_result.metadata["pi_bench_v3"]` (Harbor's `AgentContext.metadata`
is the only extensible field on the core model — see schema.py's module
docstring). `schema_version` is versioned independently of `harbor==0.22.0`.

Built by two normalizers with genuinely different data sources and genuinely
different capabilities — this document exists specifically because Gate A6
requires documenting how each side defines its fields _before_ comparing
raw numbers, not after.

| Side  | Source                                                                                                      | Module                            |
| ----- | ----------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Pi    | `pi.txt` (our own `--mode json` NDJSON stream) + self-instrumented phase timestamps recorded in `agent.py`  | `postprocess/pi_normalizer.py`    |
| Codex | Harbor's native ATIF `trajectory.json` (`harbor.agents.installed.codex:Codex`, we do not control this code) | `postprocess/codex_normalizer.py` |

## A5 — Runtime breakdown

| Field                         | Pi                                                                                                        | Codex                                                                                             |
| ----------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `container_setup_time`        | Self-instrumented (`time.monotonic`-adjacent ISO timestamps around tarball upload+extract)                | Not available — Codex's install runs inside Harbor's own adapter code, which we do not instrument |
| `dependency_setup_time`       | Self-instrumented (system deps + `nvm`/node install)                                                      | Not available                                                                                     |
| `agent_install_time`          | Self-instrumented (symlink + version probe)                                                               | Not available                                                                                     |
| `agent_startup_time`          | Process-spawn instant (self-recorded) → Pi's own `"session"` NDJSON event timestamp                       | Not available                                                                                     |
| `time_to_first_action`        | `"session"` event → first assistant message that emits a `toolCall`                                       | Not available                                                                                     |
| `active_agent_time_ms`        | Sum of `(toolResult.timestamp − enclosing assistant message.timestamp)` per tool call, matched by call id | Not available                                                                                     |
| `idle_waiting_on_provider_ms` | Deliberately `null` — not derivable from available data, not guessed                                      | `null`                                                                                            |

**Why Codex has none of this**: `populate_context_post_run(context)` — the
one hook every Harbor agent gets — only receives `AgentContext`, not
Harbor's own `TrialResult` phase timings (confirmed by reading
`harbor.trial.trial`). For our _own_ Pi adapter we work around this by
self-instrumenting inside `install()`/`run()`. For Codex, that code is
Harbor's, not ours — we cannot add instrumentation to it. Harbor's
trial-level `result.json` DOES carry `environment_setup`/`agent_setup`/
`agent_execution`/`verifier` phase timestamps for _both_ agents equally
(confirmed live, e.g. `jobs/compare-pi-02/*/result.json`) — that is the
right place to compare Pi vs. Codex setup/execution wall-time at the
_trial_ level; A5's `RuntimeBreakdown` is a Pi-only sub-phase drill-down,
not a replacement for it.

**Empirically confirmed** (`jobs/gate-a3-telemetry-check`, real container,
2026-09-01): `container_setup_time` 4.5s, `dependency_setup_time` 105s (cold
`nvm`+node install — the dominant setup cost), `agent_install_time` 935ms,
`agent_startup_time` 742ms, `time_to_first_action` 22s, `active_agent_time_ms`
13032 out of a ~2m50s total wall time — i.e. most of the wall clock in a
cold run is setup, not thinking, which is exactly the A5 problem statement
("nicht mehr: gesamte Containerzeit = Agentengeschwindigkeit").

## A6 — Token/cost breakdown

### Pi (`usage` object per `message_end` assistant event)

**Empirically verified relationship** (against real runs, not assumed):
`usage.totalTokens == usage.input + usage.output + usage.cacheRead +
usage.cacheWrite`, in every observed event. `usage.reasoning` is **not**
additive into `totalTokens` — it is a sub-count already included inside
`output` (OpenAI-style reasoning-tokens-within-output-tokens accounting).
`total_context_exposure` uses `totalTokens` directly when present (it
already equals the sum of the four additive categories); the fallback sum
explicitly excludes `reasoning` for the same reason.

`input_fresh` = raw `usage.input` (Pi's own "fresh, not cached" semantics).
Harbor's core `AgentContext.n_input_tokens` is set to `input_fresh +
input_cache_read`, unchanged from Harbor's own "includes cache" convention
— A6 only _adds_ the split via `metadata`, it does not redefine the core
field.

`cost_source = pi_usage_cost_field`: Pi's own `usage.cost.total`, a real
value from its own cost table (not a third-party estimate), but reported
only as one lump sum — no fresh/cache cost breakdown available.

### Codex (ATIF `trajectory.json`, `FinalMetrics`)

Core fields: `total_prompt_tokens` (ATIF spec: "including cached tokens"),
`total_completion_tokens`, `total_cached_tokens`, `total_cost_usd`.
`total_prompt_tokens − total_cached_tokens` gives `input_fresh`, matching
Pi's semantics.

Extra fields (`FinalMetrics.extra`, verified against
`harbor/agents/installed/codex.py:1123-1131`, not against a live file — see
below): `reasoning_output_tokens`, `total_tokens`,
`total_cache_write_input_tokens`.

**`cost_source` limitation, accepted not worked around**: Codex's own
rollout usually does not report a real cost; Harbor's adapter falls back to
a LiteLLM price-table estimate (code comment: _"Codex CLI does not include
cost in token_count events"_). The ATIF output does **not** preserve which
of the two applied for a given run. `codex_normalizer.py` therefore always
labels a present cost as `litellm_estimate`, not because it is certainly an
estimate, but because the alternative (labeling it `provider_reported`)
would overclaim certainty the data does not support. **Do not directly
compare Pi's `cost_usd` (real, single source) against Codex's `cost_usd`
(usually an estimate) as if they were the same kind of number** — this is
exactly the A6 warning about not comparing raw numbers across incompatible
cache semantics, applied to cost instead of tokens.

**Schema verified from source AND from a synthetic fixture, not from a live
Codex `trajectory.json` instance — this is a confirmed, reproducible
environment limitation, not a one-off.** This session's sandbox applies a
live, read-time content filter to file reads made through Bash-spawned
processes: real Codex `trajectory.json` files fail to `json.loads()` at
all (individual digit runs replaced in-stream with the literal text
`[REDACTED]`, breaking JSON syntax), and this reproduces on a **freshly
created** trajectory.json that had never been read before
(`jobs/gate-a3-codex-telemetry-check`), ruling out "gets corrupted once
inspected" as the mechanism — it is a per-read filter, not a one-time
on-disk corruption. A synthetic, hand-written ATIF-shaped fixture with the
same structure but without whatever real-Codex-output content trips the
filter (most likely the long base64 `encrypted_content`/reasoning-signature
blobs Codex embeds, which resemble secrets to a generic scanner) parses and
validates through `codex_normalizer.py` cleanly, confirming the extraction
_logic_ is correct — see the synthetic-fixture test in this repo's history.
Field mappings are additionally verified directly against Harbor's own
construction code (`codex.py`), which is authoritative regardless.

**This is a real, standing risk for Teil B-E, not just a testing
inconvenience**: any later step that reads a real Codex `trajectory.json`
through this same interactive session will hit the identical failure.
Options going forward (not yet decided, flag to the user before Teil B):
run Codex-side postprocessing as a detached script outside this session's
Bash tool, or accept aggregate-only figures computed once per trial
immediately after each `harbor run` (analogous to how `agent.py`'s
`populate_context_post_run()` already computes Pi's telemetry in-process
and writes only plain numbers to `result.json`, which reads back fine
afterward — Harbor's Codex adapter would need an equivalent in-process
hook, which does not currently exist for built-in agents). **Handling right
now**: never `cat`/dump a `trajectory.json`'s raw content directly; only ever pipe it
through `codex_normalizer.py` and print derived/aggregated numbers.

### A6 field-by-field, both sides

| Field                     | Pi                                                      | Codex                                                                                 |
| ------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `input_fresh`             | `usage.input` (raw)                                     | `total_prompt_tokens − total_cached_tokens`                                           |
| `input_cache_read`        | `usage.cacheRead`                                       | `total_cached_tokens`                                                                 |
| `input_cache_write`       | `usage.cacheWrite`                                      | `extra.total_cache_write_input_tokens` (often absent)                                 |
| `output`                  | `usage.output`                                          | `total_completion_tokens`                                                             |
| `reasoning`               | `usage.reasoning` (sub-count of `output`, not additive) | `extra.reasoning_output_tokens` (same convention, unverified against a live instance) |
| `provider_reported_total` | `usage.totalTokens`                                     | `extra.total_tokens`                                                                  |
| `cost_source`             | `pi_usage_cost_field` (real)                            | `litellm_estimate` (usually; provenance not distinguishable from ATIF alone)          |

## A7 — Tool-error classification

Same category enum and same `postprocess/tool_errors.py::classify()` logic
on both sides — deliberately, so a category count is comparable across
harnesses. Only the _evidence text_ fed into `classify()` differs by
source:

- **Pi**: `tool_execution_end.isError` + concatenated text content, read
  straight off the event (not the `message_end`-embedded copy, which is a
  strict subset of the same information).
- **Codex**: each `tool_call` step's matching `ObservationResult.extra["status"]`
  (Codex's own rollout item status string, verified in `codex.py:619-622`)
  — any value other than `"completed"`/`"success"` counts as `is_error`.

`permission_denied_by_harness` is Pi-specific by construction (it matches
our own fixed guard-denial string, `"Aktion vom Benutzer abgelehnt."`,
extensions/permissions/guards.ts) — Codex's own approval/sandbox layer is
bypassed entirely (`--dangerously-bypass-approvals-and-sandbox`, see
`ENVIRONMENT_LOCK.md` A4), so this category will structurally never appear
on the Codex side. That asymmetry is itself a finding, not a bug: it is one
concrete, measurable consequence of the two harnesses' different default
rights (A4).

## A8 — Subagent telemetry

| Field                          | Pi                                                                                                                     | Codex                                                                                                    |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Source                         | `pi-subagents`' `{runId}_{agent}_meta.json` (+ `_input.md`/`_output.md`) under `subagent-artifacts/`                   | ATIF `subagent_trajectories` — present in the format (v1.7+) but not populated by Harbor's Codex adapter |
| `role`/`model`/`parent_run_id` | `meta.agent` / `meta.model` / `meta.runId` (JSON fields, not filename parsing — more robust than the P4 mjs precedent) | N/A                                                                                                      |
| `spawn_time`                   | `meta.timestamp − meta.durationMs`                                                                                     | N/A                                                                                                      |
| `completion_time`              | `meta.timestamp`                                                                                                       | N/A                                                                                                      |
| `child_toolcalls`              | `meta.toolCount`                                                                                                       | N/A                                                                                                      |
| `delegated_instruction`        | `{base}_input.md` content (capped 2000 chars), falls back to `meta.task`                                               | N/A                                                                                                      |
| `child_result_summary`         | `{base}_output.md` content (capped 2000 chars)                                                                         | N/A                                                                                                      |
| `result_used_by_parent`        | `null` — not derivable from artifacts alone, not guessed                                                               | N/A                                                                                                      |
| `parallel_execution`           | Computed: `true` iff another record's `[spawn_time, completion_time]` interval overlaps                                | N/A                                                                                                      |

Codex side always carries `subagents.codex_limitation_note` pointing at
`KNOWN_LIMITATIONS.md` #1 (harbor-framework/harbor#1209, open) instead of
silently reporting zero delegations, which would misleadingly read as "Codex
never delegates" rather than "we cannot see it."

## Versioning

`VersionManifest` mirrors `ENVIRONMENT_LOCK.md`; see that file for the
authoritative pinned values. `TelemetryV3.schema_version` starts at
`"1.0.0"`; bump on any field addition/removal/redefinition, independent of
`harbor`'s or the adapter's own version.
