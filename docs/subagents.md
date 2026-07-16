# Pi Subagents

Status: migrated to the pinned `daydaylx/pi-subagents` fork.

## Summary

Subagent orchestration is provided by the third-party package
[`pi-subagents`](https://github.com/daydaylx/pi-subagents), pinned as an
immutable Git commit in `settings.json` → `packages`. The previous local
implementation (`extensions/subagents/index.ts`, `agents.ts`,
`runtime-status.ts`) has been removed.

## Why the previous No-Go was revised

An earlier session deliberately deferred third-party subagent packages with
**"No-Go until later: ... without source audit."** That audit has since been
completed. Full source review (all ~92 `.ts` files under `src/`) found:

- npm tarball byte-identical to the GitHub tag `v0.34.0`.
- Single maintainer across 89 published versions, GitHub Actions provenance
  publishing, no `postinstall` hooks.
- No network calls, telemetry, or exfiltration; the only external domain is
  an opt-in, user-initiated Gist share (`share: false` by default).
- No `eval`/dynamic remote code; all `spawn()` calls use array arguments (no
  shell injection); consistent timeout/SIGTERM/SIGKILL escalation.

Verdict: trustworthy; the audit findings are summarized above.

## Capability boundary

`pi-subagents` does not understand the previous `permission`/`writeOverride`/
`allowedPaths` frontmatter fields, and does not set the
`PI_SUBAGENT_PERMISSION_LEVEL`/`PI_SUBAGENT_WRITE_OVERRIDE`/
`PI_SUBAGENT_ALLOWED_PATHS` environment variables that `mode-permissions.ts`
used to read for spawned children (that bridge has been removed as dead code).
It restricts child processes through `--tools <list>`, which is a hard Pi-core
registry boundary: an omitted tool cannot be invoked. Reviewer, security and
exploration profiles therefore omit Bash entirely. The test-runner receives
the local `verify` tool, which accepts only the configured `typecheck`, `test`
and `verify` names and runs this setup's fixed checks from the agent directory;
it cannot pass arbitrary shell input or select repository lifecycle scripts.
Raw Bash and write tools remain exclusive to `worker`.

## Installation

The runtime source is a reviewed personal fork commit, not an npm range or
`latest`. Update it by publishing a reviewed fork commit and replacing the
full SHA in `settings.json`.

## Tool and commands

- Tool `subagent` (unchanged name), plus a `wait` tool for async control.
- Modes: `{agent, task}` (single), `{tasks:[...]}` (parallel),
  `{chain:[...]}` (chain), `{action: "list"}` (discovery — replaces the
  previous `/subagent-list` command).
- Slash commands: `/run`, `/chain`, `/run-chain`, `/parallel`,
  `/subagent-cost`, `/subagents-doctor` (replaces `/subagent-doctor`),
  `/subagents-fleet`, `/subagents-stop`, `/subagents-models`,
  `/subagents-profiles`, `/subagents-load-profile`,
  `/subagents-refresh-provider-models`, `/subagents-generate-profiles`,
  `/subagents-check-profile`, `/subagents-watchdog`.

## Agent profiles

Agents live in `agents/*.md` (user scope, since this repository directory
_is_ `~/.pi/agent`). Frontmatter no longer includes `permission` or
`writeOverride` — access is controlled entirely through the `tools:` list.

Every local profile declares the context policy explicitly:

- `defaultContext: fresh` starts with a new child conversation. The parent
  transcript is not copied into the child.
- `inheritProjectContext: true` deliberately loads the compact global and
  project context files so that safety and architecture rules still apply.
- `inheritSkills: false` keeps the parent skill catalog out of the child
  unless the assigned task itself requires a skill.

Use parent or fork context only when the delegated task materially depends on
decisions already made in the parent conversation. Reviews, repository
exploration, tests, security checks and second opinions use fresh context by
default. Context inheritance and project-context inheritance are separate:
`fresh` isolates chat history but does not suppress the intentionally enabled
static project rules.

`pi-subagents` ships 8 builtin agents (`scout`, `researcher`, `planner`,
`worker`, `reviewer`, `oracle`, `delegate`, `context-builder`). Five local
profile names collide with these builtins (`scout`, `oracle`, `planner`,
`reviewer`, `worker`); user-scope agents automatically shadow builtins with
the same name (highest discovery priority), so the local, previously
established prompts and output formats remain in effect without renaming.

| Agent              | Tools                                   | Notes                                               |
| ------------------ | --------------------------------------- | --------------------------------------------------- |
| `scout`            | read, grep, find, ls                    | read-only by tool omission                          |
| `planner`          | read, grep, find, ls                    | read-only by tool omission                          |
| `architect`        | read, grep, find, ls                    | read-only by tool omission                          |
| `reviewer`         | read, grep, find, ls                    | technically read-only                               |
| `test-runner`      | read, grep, find, ls, verify            | only allowlisted verification, no raw Bash          |
| `security-auditor` | read, grep, find, ls                    | technically read-only                               |
| `ui-reviewer`      | read, grep, find, ls                    | read-only by tool omission                          |
| `docs-auditor`     | read, grep, find, ls                    | read-only by tool omission                          |
| `worker`           | read, grep, find, ls, edit, write, bash | full write scope                                    |
| `oracle`           | read, grep, find, ls                    | fixed model + thinking; explicit fresh context      |

## Configuration

`pi-subagents` reads its own config at
`~/.pi/agent/extensions/subagent/config.json` (optional) plus a
`settings.json` → `subagents.*` key. The active local values are
`parallel.maxTasks` = 8, `parallel.concurrency` = 4,
`globalConcurrencyLimit` = 4 and `maxSubagentSpawnsPerSession` = 24.

The package implementation accepts an internal `maxOutput` value, but the
public tool schema does not reliably expose that parameter. Callers therefore
must not depend on setting it directly. The local tool-output guard applies the
repository limit of approximately 50 KiB or 2,000 lines to returned subagent
text while preserving a visible truncation notice. A stricter supported limit
must remain stricter.

## Result contract

Subagents return a compact final report with exactly these top-level sections:

```markdown
## Ergebnis

## Belege

## Betroffene Dateien

## Fehler oder Risiken

## Offene Fragen

## Empfehlung
```

Role-specific content belongs inside this shared structure. Return only the
final report to the parent context; never copy a complete child transcript,
raw tool log or hidden reasoning into it. Session artifacts may remain in the
configured session storage for diagnostics, but are not injected back into the
parent conversation.

## UI integration

Aurora owns the only custom editor, footer and activity widget. The local
`extensions/subagent/config.json` disables the package's permanent async
widget and caps both local and global concurrency at four. Subagent lifecycle
tracking, status commands and completion notifications remain available
without a second persistent UI owner.

## Delegation criteria

The compact rule in `AGENTS.md` decides when delegation is appropriate. This
document is the detailed reference for profile selection, context isolation,
result formatting and operational limits.
