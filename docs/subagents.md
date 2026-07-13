# Pi Subagents

Status: migrated to `pi-subagents` (npm, v0.34.0).

## Summary

Subagent orchestration is provided by the third-party package
[`pi-subagents`](https://github.com/nicobailon/pi-subagents), installed via
`pi install npm:pi-subagents` and pinned exactly in `settings.json` →
`packages`. The previous local implementation
(`extensions/subagents/index.ts`, `agents.ts`, `runtime-status.ts`) has been
removed.

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

Verdict: trustworthy. See the migration plan for the full audit writeup.

## Known behavior change: coarser permission model

`pi-subagents` does not understand the previous `permission`/`writeOverride`/
`allowedPaths` frontmatter fields, and does not set the
`PI_SUBAGENT_PERMISSION_LEVEL`/`PI_SUBAGENT_WRITE_OVERRIDE` environment
variables that `mode-permissions.ts` used to read for spawned children (that
bridge has been removed as dead code). It restricts child processes only
through `--tools <list>`, which is a hard registry boundary in Pi core (a
tool not in the list cannot be invoked, not merely discouraged) — but it is
coarser than the previous five permission levels.

**Concretely:** agents whose `tools:` frontmatter includes `bash`
(`reviewer`, `security-auditor`, `test-runner`) now get full Bash access in
their spawned child instead of the previous `read-bash` restriction to
provably read-only commands. This is an accepted, deliberate consequence of
the migration, not an oversight — agent system prompts still instruct
read-only Bash usage, but it is no longer technically enforced for these
three profiles.

Access is still meaningfully scoped for the read-only agents (`architect`,
`docs-auditor`, `planner`, `scout`, `ui-reviewer`, `oracle`): their `tools:`
list omits `write`/`edit`/`bash` entirely, so those tools are not registered
in the child process at all — this remains a hard boundary.

## Installation

```text
pi install npm:pi-subagents
```

Pin the resulting version exactly in `settings.json` (no `latest`/range).

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
| `reviewer`         | read, grep, find, ls, bash              | Bash now unrestricted (see above)                   |
| `test-runner`      | read, grep, find, ls, bash              | Bash now unrestricted (see above)                   |
| `security-auditor` | read, grep, find, ls, bash              | Bash now unrestricted (see above)                   |
| `ui-reviewer`      | read, grep, find, ls                    | read-only by tool omission                          |
| `docs-auditor`     | read, grep, find, ls                    | read-only by tool omission                          |
| `worker`           | read, grep, find, ls, edit, write, bash | full write scope                                    |
| `oracle`           | read, grep, find, ls                    | fixed model + thinking (no inherit/override toggle) |

## Configuration

`pi-subagents` reads its own config at
`~/.pi/agent/extensions/subagent/config.json` (optional) plus a
`settings.json` → `subagents.*` key. Relevant defaults: `parallel.maxTasks`
= 8, `parallel.concurrency` = 4, `globalConcurrencyLimit` = 20,
`maxSubagentSpawnsPerSession` = 40.

## Delegation criteria

`AGENTS.md` → "Subagenten-Delegation" remains the single source of truth for
when to delegate and which profile to use.
