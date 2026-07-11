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

| Area        | Change                                                                                                                     |
| ----------- | -------------------------------------------------------------------------------------------------------------------------- |
| Extension   | Added `extensions/subagents/index.ts` with list, single, parallel and chain execution modes.                               |
| Discovery   | Added `extensions/subagents/agents.ts` for user/project agent loading from Markdown frontmatter.                           |
| Settings    | Added `+extensions/subagents/index.ts` to `settings.json`.                                                                 |
| Permissions | `mode-permissions.ts` now honors `PI_SUBAGENT_PERMISSION_LEVEL` and `PI_SUBAGENT_WRITE_OVERRIDE` on child process startup. |
| Agents      | Added default global agents under `agents/*.md`.                                                                           |
| Prompts     | Added `prompts/subagent-*.md` workflow templates.                                                                          |
| Tests       | Added regression coverage in `tests/run.mjs`.                                                                              |

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

| Mode     | Input                               | Purpose                                |
| -------- | ----------------------------------- | -------------------------------------- |
| list     | `{ "list": true }`                  | Show available agents.                 |
| single   | `{ "agent": "...", "task": "..." }` | One bounded task.                      |
| parallel | `{ "tasks": [...] }`                | Independent reviews or scouts.         |
| chain    | `{ "chain": [...] }`                | Sequential handoff using `{previous}`. |

Limits:

- Maximum parallel tasks: 6.
- Maximum concurrent child processes: 3.
- Model-visible output cap per parallel task: 40 KiB.
- Default timeout: 10 minutes unless overridden per agent.
- No nesting: a subagent child process refuses to spawn further subagents,
  and a `subagent` entry in an agent's `tools` frontmatter is stripped.

### Choosing a mode

- **single** — one bounded task on one agent. Default for most work.
- **parallel (`tasks[]`)** — same target, multiple independent lenses at once.
  Use when the angles do not depend on each other, e.g. review one diff with
  `reviewer` + `security-auditor` + `test-runner` simultaneously.
- **chain (`chain[]`)** — pipeline where each step's output feeds the next via
  `{previous}`. Use when step B needs step A's result, e.g. `scout` → `planner`.

## Agent Profiles

| Agent              | Tools                                   | Permission | Write Override | Model                  | Thinking                 | Use                             |
| ------------------ | --------------------------------------- | ---------- | -------------- | ---------------------- | ------------------------ | ------------------------------- |
| `scout`            | read, grep, find, ls                    | read-only  | block          | inherit (Hauptmodell)  | inherit (Haupt-Thinking) | Collect codebase context.       |
| `planner`          | read, grep, find, ls                    | read-only  | block          | inherit (Hauptmodell)  | inherit (Haupt-Thinking) | Produce implementation plans.   |
| `architect`        | read, grep, find, ls                    | read-only  | block          | inherit (Hauptmodell)  | inherit (Haupt-Thinking) | Architecture critique.          |
| `reviewer`         | read, grep, find, ls, bash              | read-bash  | block          | inherit (Hauptmodell)  | inherit (Haupt-Thinking) | Review diffs and scope.         |
| `test-runner`      | read, grep, find, ls, bash              | test-bash  | block          | inherit (Hauptmodell)  | inherit (Haupt-Thinking) | Run safe tests/checks.          |
| `security-auditor` | read, grep, find, ls, bash              | read-bash  | block          | inherit (Hauptmodell)  | inherit (Haupt-Thinking) | Security and permission audit.  |
| `ui-reviewer`      | read, grep, find, ls                    | read-only  | block          | inherit (Hauptmodell)  | inherit (Haupt-Thinking) | Static UI/UX review.            |
| `docs-auditor`     | read, grep, find, ls                    | read-only  | block          | inherit (Hauptmodell)  | inherit (Haupt-Thinking) | Docs/code drift.                |
| `worker`           | read, grep, find, ls, edit, write, bash | read-write | inherit        | inherit (Hauptmodell)  | inherit (Haupt-Thinking) | Narrow approved implementation. |
| `oracle`           | read, grep, find, ls                    | read-only  | block          | qwen3.7-max (override) | high (override)          | Second opinion.                 |

All agents are stored in `agents/*.md`. Each file uses frontmatter. Since
#58/#59, `model`/`thinking` are optional: omitting them (the default for
every profile except `oracle`) means the agent inherits the main agent's
currently active model/thinking level at spawn time.

```yaml
name: scout
description: Builds compact codebase context
tools: read, grep, find, ls
permission: read-only
writeOverride: block
timeoutMs: 600000
# optional guardrails:
allowedPaths: src, tests
fallbackModels: opencode-go/deepseek-v4-flash, opencode-go/qwen3.7-plus
requiredSections: Summary, Risks
sandboxMode: none
```

Additional frontmatter guardrails:

- `allowedPaths` (#46): comma-separated project-relative/absolute paths where a
  write-capable agent may write. Agents with `write`/`edit` but no
  `allowedPaths` require interactive confirmation and are blocked in
  non-interactive mode.
- `fallbackModels` (#54): comma-separated model IDs tried after the primary
  model fails with a provider/model error (e.g. unavailable provider, auth/rate
  limit/5xx/network errors). Normal task failures, output validation errors,
  aborts and timeouts do **not** retry. Attempt details are recorded under
  `result.details.results[].modelAttempts` and `/subagent-doctor` lists the
  fallback chain.
- `requiredSections` (#53): comma-separated output sections that must appear as
  Markdown headings (`## Summary`) or labels (`Summary:`). Missing sections mark
  the run as failed with `validationErrors` in details.
- `sandboxMode` (#52): `none` (default) or `git-worktree`. `git-worktree` is
  parsed and shown by `/subagent-doctor`, but execution is intentionally
  blocked until full worktree creation/cleanup isolation is implemented in a
  follow-up plan.
- `modelMode`/`thinkingMode` (#58/#59): `inherit` (default when `model:`/
  `thinking:` is absent) takes the main agent's currently active model or
  thinking level for every spawn. `override` (default when `model:`/
  `thinking:` is set) keeps the profile's fixed value regardless of what the
  main agent uses — the deliberate exception used by `oracle` for an
  independent second opinion. On a fallback-model switch, the requested
  thinking level is re-validated per attempt against the newly targeted
  model's capabilities; an unsupported level is clamped to the highest
  supported one and reported (not applied silently) in the tool result and
  `/subagent-doctor`.

## Workflow Templates

Prompt templates can strongly require a first `subagent` tool call, but they do
not turn into a hard runtime hook by themselves. If Pi routes a `/subagent-*`
template to the main model, the model must still select the tool. The templates
therefore use explicit Tool-first wording and a fallback diagnosis path. The
real diagnostic commands `/subagent-doctor` and `/subagent-list` do not depend on
model tool selection.

| Template                               | Purpose                                                 |
| -------------------------------------- | ------------------------------------------------------- |
| `/subagent-list`                       | List configured user-level agents.                      |
| `/subagent-scout-plan <task>`          | `scout -> planner`, no implementation.                  |
| `/subagent-review [focus]`             | Single reviewer pass.                                   |
| `/subagent-parallel-review [focus]`    | Reviewer, security auditor and test runner in parallel. |
| `/subagent-docs [scope]`               | Documentation audit.                                    |
| `/subagent-security [focus]`           | Security audit.                                         |
| `/subagent-ui-review [scope]`          | Static UI/UX review.                                    |
| `/subagent-implement <approved scope>` | Worker implementation after explicit approval.          |

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
- `test-bash`: like `read-bash`, plus curated non-destructive test/check commands (e.g. `npm test`, `tsc --noEmit`, `npm run lint` without `--fix`); package management, build/fix and destructive commands stay blocked (#43).
- `full-access`/`yolo` in agent frontmatter are always capped to `read-write`
  (#36). Running such an agent requires interactive confirmation and is
  blocked in non-interactive contexts; the declared elevated level is never
  passed to the child process.
- `read-write`: write/edit allowed inside project, risky bash still blocks in
  non-interactive child processes.
- `writeOverride=block`: write-capable bash is denied even if bash exists.
- `allowedPaths` limits subagent `write`/`edit` calls in the child process;
  writes outside the configured paths are blocked (#46).
- Write-capable agents without `allowedPaths` require interactive parent
  confirmation and are denied in non-interactive mode (#46).
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
    {
      "agent": "planner",
      "task": "Create a plan using this context:\n{previous}"
    }
  ],
  "agentScope": "user"
}
```

## Diagnose (#44)

Wenn Subagenten nicht genutzt werden oder das Tool leer erscheint, in dieser
Reihenfolge prüfen:

1. **Ist die Extension geladen?** `/tools` ausführen und prüfen, ob `subagent`
   in der Liste erscheint. Fehlt es, lädt `settings.json` die Extension nicht
   (Eintrag `+extensions/subagents/index.ts` prüfen).
2. **Direkte Diagnose:** `/subagent-doctor` ausführen. Der Command ist nicht
   vom Modell-Tool-Selection-Verhalten abhängig und zeigt secret-frei:
   - `Extension geladen: ja`
   - `subagent-Tool registriert: ja/nein`
   - `PI_CODING_AGENT_DIR` oder den Fallback `~/.pi/agent`
   - erwarteter User-Agentenpfad und ob er existiert
   - Anzahl User-Agenten
   - Projekt-Agentenpfad (`.pi/agents`) und ob er existiert
   - Anzahl Projekt-Agenten
   - effektive Agentenliste mit Scope `both`
   - übersprungene Agent-Dateien mit Grund
   - Hinweise zu unbekannten Tools, Timeout-Clamps, Sandbox-Modi und
     Model-Fallbacks
   - konkrete nächste Schritte bei 0 gefundenen Agenten
3. **Direkte Liste:** `/subagent-list` ausführen. Der Command listet standardmäßig
   `agentScope: "user"`; optional sind `/subagent-list project` und
   `/subagent-list both`. Bei 0 Agenten verweist er auf `/subagent-doctor`. Jede
   Agentenzeile zeigt zusätzlich den aktuellen Live-Status aus dem
   Subagent-Widget (z. B. `[● running — plan structure]` oder `[idle]`), damit
   sichtbar wird, welcher Agent gerade tatsächlich läuft, ohne eine zweite
   Statuswelt einzuführen.
4. **Tool-Minimal-Run:** Wenn `/subagent-list` funktioniert, aber der Hauptagent
   nicht delegiert, das `subagent`-Tool direkt mit
   `{ "list": true, "agentScope": "user" }` aufrufen lassen. Das trennt
   Discovery-Probleme von Modell-Tool-Auswahl.
5. **Lokale Pfade prüfen:** `pwd`, `echo "$PI_CODING_AGENT_DIR"`,
   `ls -la ~/.pi/agent/agents`, `ls -la ./agents` — insbesondere ob dieses
   Repository tatsächlich als Pi-Agent-Konfigurationsordner (`~/.pi/agent`)
   genutzt wird. Ist `PI_CODING_AGENT_DIR` falsch gesetzt, sucht Pi unter
   `<PI_CODING_AGENT_DIR>/agents` und nicht im aktuellen Repo.
6. **Child-Prozess prüfen:** bei Fehlern in `result.details.results[].stderr`
   nachsehen, ob `pi --mode json -p --no-session` lokal überhaupt startet und
   die Flags `--tools`, `--model`, `--thinking`, `--append-system-prompt`
   akzeptiert.

Beim TUI-Session-Start warnt die Extension sichtbar, falls keine User-Agenten
gefunden werden. Das ist keine Aussage über Modellqualität oder Billing, sondern
ein Pfad-/Discovery-Hinweis.

Das Status-Widget zeigt zusätzlich:

```text
Subagents: loaded | Agents: <count> | Last run: none
```

Nach einem Tool-Lauf wird `Last run` auf `<agent>/<mode>/<time>` aktualisiert,
z. B. `reviewer/single/2026-07-10T12:00:00Z`. Lange Nicht-Nutzung ist kein
Fehler; sie ist über Doctor/List/Widget nur sichtbar diagnostizierbar.

### Statusmodell und Tool-Zuordnung (UI-Redesign)

Das Widget (`extensions/subagents/widget.ts`) nutzt jetzt ein klareres,
nachvollziehbares Statusmodell. Jeder Subagent zeigt **Symbol + Textlabel**
(nie nur Farbe):

| Status      | Symbol | Bedeutung                                      |
| ----------- | ------ | ---------------------------------------------- |
| `running`   | `●`    | Prozess läuft gerade                           |
| `queued`    | `○`    | Wartet auf Slot (Parallelmodus)                |
| `waiting`   | `○`    | Wartet auf Parent-Bestätigung (Permissions)    |
| `completed` | `✓`    | Erfolgreich abgeschlossen                      |
| `warning`   | `!`    | Warnungen/Validierungsfehler, nicht abgestürzt |
| `failed`    | `✕`    | Fehler/Abbruch/kein Output                     |
| `blocked`   | `⏸`    | Blockiert (Permission/Sandbox)                 |
| `idle`      | `○`    | Noch nie gelaufen                              |

Zusätzlich pro Eintrag sichtbar: `role`, `lastAction`, `warnings`/`errors`
(kompakt als `w:n` / `e:n`), `startedAt`/`completedAt` und `relatedToolCalls`.

**Tool-Zuordnung:** Der Parent-Prozess wertet jetzt zusätzlich die
Child-JSON-Events `tool_execution_start`, `tool_execution_update` und
`tool_execution_end` aus und hängt sie als `toolCalls` an `SingleResult` an
(`toolCallId`, `toolName`, `args`, `status`, `summary`, `startedAt`,
`completedAt`, `isError`). `renderCall`/`renderResult` des `subagent`-Tools
zeigen kompakte, eindeutig zugeordnete Zeilen:

```text
subagent parallel  ● running 1/3
[planner]   read       src/ui/theme.ts   ✓ completed
[tester]    bash       npm test          ● running
[reviewer]  grep       risk              ✕ failed
```

Grenzen: Chain bleibt sequenziell (nur der aktuelle Schritt ist `running`);
Parallelität wird nicht vorgetäuscht (nur echtt gestartete Tasks sind
`running`, Platzhalter vorab sind `queued`).

## Verification Plan

Automated:

- `npm --prefix npm test`
- `npm --prefix npm run typecheck` (real `tsc --noEmit`, see "Typecheck" below; #39)
- Extension import smoke test.
- Agent discovery smoke test.
- Subagent list tool smoke test.
- Project-local non-interactive denial test.
- Child permission env override test.

Manual:

```text
/tools
```

Expected: `subagent` appears as an available tool. If missing, the extension is
not loaded; check `settings.json` for `+extensions/subagents/index.ts`.

```text
/subagent-doctor
```

Expected: shows `Extension geladen: ja`, `subagent-Tool registriert: ja`,
`PI_CODING_AGENT_DIR`, user/project paths, existence flags, agent counts,
skipped files (if any) and next steps when count is 0.

```text
/subagent-list
```

Expected: lists the user-level agents from `agents/*.md` (or from
`$PI_CODING_AGENT_DIR/agents`). With `/subagent-list both`, project-local
`.pi/agents/*.md` are included in the effective list.

```text
/subagent-scout-plan kleine Testanalyse
```

Expected: the prompt requires the main model to call `subagent` first with a
`scout -> planner` chain. It should produce a plan and not modify files. If the
model refuses or no agents are found, it should report `/tools`,
`/subagent-doctor`, `/subagent-list` and `PI_CODING_AGENT_DIR`.

```text
/subagent-parallel-review kleiner Diff
```

Expected: the prompt requires a parallel `reviewer`, `security-auditor` and
`test-runner` run. It summarizes findings without editing files.

Additional checks:

- Verify the widget/status line shows `Subagents: loaded`, `Agents: <count>` and
  `Last run: none` initially, then the last `<agent>/<mode>/<time>` after a run.
- Verify read-only agents produce no `git diff`.
- Verify project-local agents ask for confirmation in TUI.
- Verify Ctrl+C aborts an active subagent process.

## Typecheck (#39)

`extensions/**/*.ts` is now covered by a real `tsc --noEmit` run:
`npm --prefix npm run typecheck` (config: `tsconfig.json` at repo root).
It is intentionally **not** chained into `npm test`, because two pre-existing,
subagents-unrelated files currently fail it — chaining it in would make the
whole suite red for reasons outside this area's control.

`@earendil-works/pi-agent-core` is a transitive dependency declared by
`pi-coding-agent` but not present under `npm/node_modules` in this dev
install; `types/shims.d.ts` declares it as an ambient `any`-typed module so
the real code can still be checked.

Known pre-existing failures (not subagents-related, not fixed here):

| File                                 | Error                                                                                                            |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `extensions/ask-user.ts`             | `DisplayOption` narrowing loses `description`/`effort`/`risk`/`pro`/`contra` on the `isOther` branch (9 errors). |
| `extensions/shared/banner-render.ts` | `process.env` is not assignable to `Pick<ProcessEnv, "NO_COLOR">`.                                               |

## Remaining Risks

| Risk                                  | Status                                                            | Mitigation                                                          |
| ------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------- |
| Worker has write tools                | Accepted but gated by prompt, permission policy and explicit use. | Use only after approved scope.                                      |
| Child processes load global settings  | Accepted.                                                         | Child permission env prevents Auto-YOLO default.                    |
| Project-local agents can be malicious | Controlled.                                                       | User scope default; confirmation required for project scope.        |
| Model IDs may become unavailable      | Possible.                                                         | Agent files isolate model choices for easy updates.                 |
| Test-runner commands may write caches | Possible.                                                         | Prompt forbids source writes; permission blocks write-capable bash. |
| No true OS sandbox                    | Known Pi limitation.                                              | Use container/Gondolin for untrusted repos.                         |

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
