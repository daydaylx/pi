# Pi Subagents

Status: Phase 1 implementation.

This document records the implemented plan, concrete changes, safety rules and
verification steps for the local Pi subagent setup.

## Summary

Subagents are implemented as a local Pi extension, not as a third-party package.
The extension registers a single `subagent` tool. Each delegated task runs in a
separate `pi --mode json -p --no-session` process with an explicit agent prompt,
tool allowlist, thinking level and permission override.

The default agent source is user-level `~/.pi/agent/agents/*.md`, which is this
repository directory. Project-local agents from `.pi/agents/*.md` are supported
only when requested through `agentScope: "project"` or `"both"` and require
interactive confirmation by default.

The initial rollout is intentionally conservative:

- Read-only agents are the default.
- Only `worker` has `edit` and `write`.
- Bash-capable agents use `read-bash` and `writeOverride=block`.
- Child Pi processes receive explicit permission environment variables so they
  do not inherit the global Auto-YOLO default.
- No persistent background loops or unattended workers are implemented.

## Implemented Changes

| Area | Change |
| --- | --- |
| Extension | Added `extensions/subagents/index.ts` with list, single, parallel and chain execution modes. |
| Discovery | Added `extensions/subagents/agents.ts` for user/project agent loading from Markdown frontmatter. |
| Settings | Added `+extensions/subagents/index.ts` to `settings.json`. |
| Permissions | `mode-permissions.ts` now honors `PI_SUBAGENT_PERMISSION_LEVEL` and `PI_SUBAGENT_WRITE_OVERRIDE` on child process startup. |
| Agents | Added default global agents under `agents/*.md`. |
| Prompts | Added `prompts/subagent-*.md` workflow templates. |
| Tests | Added regression coverage in `tests/run.mjs`. |

## Local State

Observed before implementation:

- Pi version: `0.80.3`.
- No installed `pi-subagents` package.
- No existing `agents/`, `skills/`, `chains/`, `SYSTEM.md` or `APPEND_SYSTEM.md`.
- Existing prompt templates: `analyse`, `review`, `ui-review`, `docs-check`.
- Existing custom extensions: plan mode, permission policy, ask-user, tools,
  actions, UX status and notification.
- `settings.json` and `extensions/shared/visual-system.ts` were already dirty
  before this work and were not reverted.

## Architecture

The main agent remains the orchestrator. Subagents are only execution helpers.

Flow:

1. The main agent invokes the `subagent` tool.
2. The extension discovers allowed agent profiles.
3. The selected profile contributes:
   - system prompt,
   - tool allowlist,
   - model,
   - thinking level,
   - permission level,
   - write override,
   - timeout.
4. The extension writes the subagent prompt to a `0600` temporary file.
5. It starts a separate `pi --mode json -p --no-session` process.
6. It streams JSON events back into the parent tool result.
7. It truncates large model-visible parallel output while preserving structured
   details in the tool result.

Supported tool modes:

| Mode | Input | Purpose |
| --- | --- | --- |
| list | `{ "list": true }` | Show available agents. |
| single | `{ "agent": "...", "task": "..." }` | One bounded task. |
| parallel | `{ "tasks": [...] }` | Independent reviews or scouts. |
| chain | `{ "chain": [...] }` | Sequential handoff using `{previous}`. |

Limits:

- Maximum parallel tasks: 6.
- Maximum concurrent child processes: 3.
- Model-visible output cap per parallel task: 40 KiB.
- Default timeout: 10 minutes unless overridden per agent.

## Agent Profiles

| Agent | Tools | Permission | Write Override | Model | Thinking | Use |
| --- | --- | --- | --- | --- | --- | --- |
| `scout` | read, grep, find, ls | read-only | block | deepseek-v4-flash | medium | Collect codebase context. |
| `planner` | read, grep, find, ls | read-only | block | deepseek-v4-pro | high | Produce implementation plans. |
| `architect` | read, grep, find, ls | read-only | block | deepseek-v4-pro | xhigh | Architecture critique. |
| `reviewer` | read, grep, find, ls, bash | read-bash | block | deepseek-v4-pro | high | Review diffs and scope. |
| `test-runner` | read, grep, find, ls, bash | read-bash | block | deepseek-v4-flash | medium | Run safe checks. |
| `security-auditor` | read, grep, find, ls, bash | read-bash | block | deepseek-v4-pro | high | Security and permission audit. |
| `ui-reviewer` | read, grep, find, ls | read-only | block | kimi-k2.6 | high | Static UI/UX review. |
| `docs-auditor` | read, grep, find, ls | read-only | block | deepseek-v4-flash | medium | Docs/code drift. |
| `worker` | read, grep, find, ls, edit, write, bash | read-write | inherit | deepseek-v4-pro | high | Narrow approved implementation. |
| `oracle` | read, grep, find, ls | read-only | block | qwen3.7-plus | high | Second opinion. |

All agents are stored in `agents/*.md`. Each file uses frontmatter:

```yaml
name: scout
description: Builds compact codebase context
tools: read, grep, find, ls
model: opencode-go/deepseek-v4-flash
thinking: medium
permission: read-only
writeOverride: block
timeoutMs: 600000
```

## Workflow Templates

| Template | Purpose |
| --- | --- |
| `/subagent-list` | List configured user-level agents. |
| `/subagent-scout-plan <task>` | `scout -> planner`, no implementation. |
| `/subagent-review [focus]` | Single reviewer pass. |
| `/subagent-parallel-review [focus]` | Reviewer, security auditor and test runner in parallel. |
| `/subagent-docs [scope]` | Documentation audit. |
| `/subagent-security [focus]` | Security audit. |
| `/subagent-ui-review [scope]` | Static UI/UX review. |
| `/subagent-implement <approved scope>` | Worker implementation after explicit approval. |

## Permission Model

The local Pi configuration has `AUTO_YOLO_ON_START=true`. That remains unchanged
for normal sessions, but subagent child processes are pinned by environment:

- `PI_SUBAGENT_PERMISSION_LEVEL`
- `PI_SUBAGENT_WRITE_OVERRIDE`

`mode-permissions.ts` reads these variables on session startup if no persisted
session state exists. Since subagents run with `--no-session`, the env override
applies reliably to child processes.

Rules:

- `read-only`: no bash, no writes.
- `read-bash`: read tools and proven read-only bash only.
- `read-write`: write/edit allowed inside project, risky bash still blocks in
  non-interactive child processes.
- `writeOverride=block`: write-capable bash is denied even if bash exists.
- Project-local agents require interactive confirmation unless
  `confirmProjectAgents: false` is explicitly passed.
- In non-interactive contexts, project-local agents are denied by default when
  confirmation is required.

Hard boundaries:

- No sudo.
- No package installation.
- No force push.
- No deletion.
- No secret file reads or prompt copying.
- No uncontrolled background loops.
- No automatic worker/reviewer loop.

## Usage Examples

List agents:

```text
/subagent-list
```

Plan without implementing:

```text
/subagent-scout-plan add a safer permission profile for test runners
```

Parallel review:

```text
/subagent-parallel-review subagent extension safety and docs
```

Direct tool shape:

```json
{
  "agent": "reviewer",
  "task": "Review current worktree changes for safety and missing tests",
  "agentScope": "user"
}
```

Chain shape:

```json
{
  "chain": [
    { "agent": "scout", "task": "Find code relevant to permissions" },
    { "agent": "planner", "task": "Create a plan using this context:\n{previous}" }
  ],
  "agentScope": "user"
}
```

## Verification Plan

Automated:

- `npm --prefix npm test`
- Extension import smoke test.
- Agent discovery smoke test.
- Subagent list tool smoke test.
- Project-local non-interactive denial test.
- Child permission env override test.

Manual:

- Start Pi and confirm `/tools` includes `subagent`.
- Run `/subagent-list`.
- Run `/subagent-scout-plan <small task>` and verify no files change.
- Run `/subagent-review` after a small diff.
- Verify read-only agents produce no `git diff`.
- Verify project-local agents ask for confirmation in TUI.
- Verify Ctrl+C aborts an active subagent process.

## Remaining Risks

| Risk | Status | Mitigation |
| --- | --- | --- |
| Worker has write tools | Accepted but gated by prompt, permission policy and explicit use. | Use only after approved scope. |
| Child processes load global settings | Accepted. | Child permission env prevents Auto-YOLO default. |
| Project-local agents can be malicious | Controlled. | User scope default; confirmation required for project scope. |
| Model IDs may become unavailable | Possible. | Agent files isolate model choices for easy updates. |
| Test-runner commands may write caches | Possible. | Prompt forbids source writes; permission blocks write-capable bash. |
| No true OS sandbox | Known Pi limitation. | Use container/Gondolin for untrusted repos. |

## Files Changed

Implementation files:

- `extensions/subagents/index.ts`
- `extensions/subagents/agents.ts`
- `extensions/mode-permissions.ts`
- `settings.json`

Agent profile files:

- `agents/scout.md`
- `agents/planner.md`
- `agents/architect.md`
- `agents/reviewer.md`
- `agents/test-runner.md`
- `agents/security-auditor.md`
- `agents/ui-reviewer.md`
- `agents/docs-auditor.md`
- `agents/worker.md`
- `agents/oracle.md`

Prompt templates:

- `prompts/subagent-list.md`
- `prompts/subagent-scout-plan.md`
- `prompts/subagent-review.md`
- `prompts/subagent-parallel-review.md`
- `prompts/subagent-docs.md`
- `prompts/subagent-security.md`
- `prompts/subagent-ui-review.md`
- `prompts/subagent-implement.md`

Docs/tests:

- `docs/subagents.md`
- `tests/run.mjs`

## Go / No-Go

Go:

- Read-only and read-bash subagents.
- Planning, review, docs, security and UI review workflows.
- Worker only for narrow approved scopes.

No-Go until later:

- Autonomous background workers.
- Unbounded parallel fan-out.
- SDK-level orchestrator.
- Third-party `pi-subagents` package installation without source audit.
- Worker chains that automatically fix review feedback without user approval.
