# ENVIRONMENT_LOCK.md — Benchmark v3, Teil A1/A4

Pinned versions and the harness-rights comparison for Benchmark v3. Rebuilt
whenever the pinned components change; never silently updated mid-cycle
(Auftragsregel "keine stillen Updates während eines Benchmark-Durchlaufs").

## Pinned components

| Component                                           | Pin                                                                              | Mechanism                                                                                                              | Verified live                                                                       |
| --------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Harbor                                              | `0.22.0`                                                                         | `pyproject.toml` / `uv.lock` (exact)                                                                                   | yes (existing)                                                                      |
| Pi source                                           | git SHA + dirty flag, e.g. `f661be9…` / `dirty=true` while Teil A is in progress | `scripts/build_version_manifest.py` → `MANIFEST.json`, baked into `environments/pi-product-stack.tar.gz` at build time | yes — `jobs/gate-a2-pi-3` read `/opt/pi-harness/MANIFEST.json` inside the container |
| Pi CLI package (`@earendil-works/pi-coding-agent`)  | `0.84.3` (from tarball's `npm/node_modules`)                                     | frozen in tarball                                                                                                      | yes                                                                                 |
| `pi-subagents` fork                                 | `11f3fcbc0e346f747df2bd8342d77cb8c9f8c962` (git-SHA-pinned dependency spec)      | `npm/package.json` `dependencies.pi-subagents`                                                                         | yes (pre-existing)                                                                  |
| Node.js (Pi container)                              | `22.23.2` exact (not just major 22)                                              | `nvm_node_install_snippet(node_major=<from MANIFEST.json>)` in `agent.py.install()`                                    | yes — trial.log: `nvm install 22.23.2 && nvm alias default 22.23.2`                 |
| Node.js (task Dockerfiles)                          | `node:22.23.2-bookworm-slim`                                                     | Dockerfile `FROM`                                                                                                      | yes (pre-existing)                                                                  |
| Codex CLI                                           | `0.151.0` exact                                                                  | `--ak version=0.151.0` (Harbor's built-in `codex.py` `install()`, `npm install -g @openai/codex@{version}`)            | yes — trial.log: `npm install -g @openai/codex@0.151.0`                             |
| Adapter (`agents.pi_harness.agent:PiHarnessTrackA`) | name `pi-product-harness`, own semver `3.0.0`                                    | `_ADAPTER_VERSION` constant in `agent.py`                                                                              | —                                                                                   |

Codex version was previously unpinned (`@latest`); `0.151.0` was the current
`npm view @openai/codex version` result at the time of pinning
(2026-09-01) — a deliberate freeze of "whatever was current", not an
endorsement of that specific version being special.

## Gate A1 — how "two containers report identical versions" is satisfied

Rather than _measuring_ version facts independently per container (which
could drift if e.g. `npm install -g typescript` silently resolved a newer
patch on two different days), the Pi side **bakes `MANIFEST.json` into the
one build artifact** (`pi-product-stack.tar.gz`) that every container
extracts from. Two containers built from the same tarball are byte-identical
on this point by construction, not by coincidence. The Codex side is pinned
the same way, via the exact `--ak version=` value used across a whole
benchmark cycle (recorded in every job's `config.json`).

## A4 — Codex vs. Pi runtime rights (documented asymmetry, not equalized)

|                                                                                   | Pi (`project-write` + `--approve`, Benchmark v3)                                                                                                                                                | Codex (Harbor's built-in adapter)                                                                                                                       |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Confirmation prompts                                                              | None for test/build/typecheck/lint/git/subagent/LSP/`project_check` (headless ASK auto-resolves to deny for the few remaining sensitive patterns, e.g. `rm`, `sudo`, package installs — see A3) | None at all — Harbor's `codex.py` runs `codex exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check …`, hardcoded, no kwarg disables it |
| Project trust gate                                                                | Bypassed via `--approve` (`trustOverride=true`), independent of whether the task repo has a `.pi/` directory                                                                                    | N/A (Codex has no equivalent trust gate)                                                                                                                |
| Git repo check                                                                    | Enforced by the canonical git baseline (Gate A2); Codex's own `--skip-git-repo-check` flag confirms Codex itself expects one to exist                                                           | Explicitly skipped by Harbor, but only _because_ the baseline (A2) already guarantees a real repo is there                                              |
| Destructive/system ops (`rm`, `sudo`, package installs, opaque interpreter calls) | Auto-denied under `project-write` in headless mode (deterministic, not a hang)                                                                                                                  | Unrestricted                                                                                                                                            |

This is an intentionally **documented, not equalized** difference (per Gate
A4's own wording: "unvermeidbare Harness-Unterschiede dokumentieren [...]
nicht künstlich versuchen, beide Harnesses intern identisch zu machen"). Pi
is measurably more conservative by default; Codex is measurably more
permissive by default. Both are "full rights for the benchmark's intended
actions" in their own harness's terms.

## Known residual gap (see KNOWN_LIMITATIONS.md)

`rm`/`git rm` are auto-denied under Pi `project-write` in headless mode
(`SENSITIVE_ASK_PATTERNS` in `extensions/shared/permission-policy.ts`). Not a
Gate A3 blocker (the gate's required-capability list does not include
deletion), but `tasks/_gate/permission-smoke` exercises a deletion step
anyway to record the actual behavior for Teil D task design.
