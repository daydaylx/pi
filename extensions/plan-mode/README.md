# Plan workflow extension

The extension implements a lightweight workflow:

```text
/plan → /work
```

`/review-plan` and `/finish` are optional/automatic complements, not required
steps.

## Commands

- `/plan` or `Ctrl+Alt+P`: opens a **state-aware plan assistant** (see
  "`/plan` plan assistant" below). It inspects whether a plan already exists,
  whether its todos are complete, and whether a review/execution is running,
  then offers matching actions through the shared overlay menu. Existing plans
  are never silently overwritten; without an interactive TUI it falls back to
  starting the detailed plan mode only when no plan exists yet.
- `/decide`: starts the optional **Decision-Intake** (see "Decision-Intake
  (Klärmodus)" below) — an interactive clarification that produces a Decision
  Brief. It is also reachable as the _Optionen klären_ action inside `/plan`
  and as the first-level Shift+Tab Control-Center entry of the same name.
- `/work` (primary) or `/go` (alias): execute the current plan directly. Runs
  independently of whether a review happened. A duplicate call during an active
  turn is ignored; after the turn settled with open todos, `/work` continues the
  same execution ID instead of aborting and restarting it.
- `/review-plan`: optional deep review; worth it for large, risky, or
  architectural changes. It records review status without changing the active
  workflow mode or gating `/work`.
- `/plan-todos`: read progress from the current plan file.
- `/done <n> [m …]`: manually check off todo numbers (as listed by
  `/plan-todos`). Manual fallback when an explicit progress update was missed.
  It is accepted only while Pi is idle and uses the same hash-bound
  completion/archive path as `plan_progress`.
- `/finish`: manual archive/early-abort. Runs automatically once all todos
  are checked off (see "Completion").

## Plan variants

`/plan` is a state-aware assistant (details below). Shift+Tab opens the
temporary **Control Center** (`buildControlCenterMenu()`/`openControlCenter()`):
its first four immediately selectable entries remain **Schnellplan**,
**Architekturplan**, **Work-Modus** and the non-persistent **Optionen klären**.
They are followed by separate submenus for the fixed Fast/Primary/Deep model
roles, Thinking, permissions and one-file LSP diagnostics. Native skills use
Pi Core's `/skill:<name>` commands and are intentionally not a workflow-menu
entry.
Internal `WorkflowMode` values are unchanged; only the labels were renamed for
clarity:

- **Schnellplan** (`simple_plan`) — compact questions and a short plan file
  for small to medium tasks.
- **Architekturplan** (`detailed_plan`) — detailed context, risk,
  architecture and implementation analysis using the same plan file.
- **Work** (`work`) — normal work. Selecting Work in Shift+Tab does not
  automatically execute a stored plan; `/work` remains the explicit execution
  command.
- **Optionen klären** (`"decide"` / `"decide-mode"`) — not a `WorkflowMode`.
  Selecting it from Shift+Tab switches **silently** into the transient
  `deciding` phase (`action: "decide-mode"`) without starting a turn, exactly
  like the other modes — the intake prompt is injected on the next user turn.
  The explicit entry points `/decide` and the _Optionen klären_ action inside
  `/plan` start the intake immediately. Neither action changes `mode` or the
  permission level. The former `Ctrl+Shift+X` command menu was removed.

**Thinking coupling.** Thinking has an explicit **Auto**/**Manuell** state.
Auto follows the workflow default (`MODE_THINKING` in `index.ts`): Schnellplan
→ `medium`, Architekturplan → `xhigh`, Work → `high`. A manually selected level
via the Control Center or `Ctrl+Shift+T` persists across workflow changes and
session restoration until Auto is explicitly selected again. Selecting Auto
immediately restores the active workflow default.

**Subagent reminders.** Every injected mode/phase prompt (`SIMPLE_PLAN_PROMPT`,
`detailed_plan`, `executing`, `reviewing`, `deciding`) includes a short,
generic pointer to use the `subagent` tool when it fits the current step,
without naming individual agents or repeating delegation criteria (#55/#56)
— it points back to `AGENTS.md` → "Subagenten-Delegation", which remains the
single source of truth for which agent to use and when. The two "executing"
phase injections (`before_agent_start` and `executePlan()`) share one string
constant (`SUBAGENT_EXECUTING_REMINDER`) so they can't drift apart again.

## `/plan` plan assistant

`/plan` and `Ctrl+Alt+P` route through the same assistant. It renders the
shared `runMenu(...)` overlay (with a plain `ctx.ui.select(...)` fallback) and
offers different actions depending on the current state:

- **No plan file exists** — _Neuer Schnellplan_, _Neuer Architekturplan_,
  _Abbrechen_.
- **Plan exists, todos still open** — _Aktuellen Plan weiterführen_,
  _Neuer Schnellplan_, _Neuer Architekturplan_, _Aktuellen Plan reviewen_,
  _Aktuellen Plan ausführen_, _Plan-Todos anzeigen_, _Plan archivieren_,
  _Abbrechen_.
- **Plan exists, all todos complete** — _Plan archivieren_,
  _Neuer Schnellplan_, _Neuer Architekturplan_, _Plan-Todos anzeigen_,
  _Abbrechen_.
- **Review or execution running** — the assistant shows a hint notification
  but does not hard-block; the menu remains available, and any active turn is
  normalized through the existing `setWorkflowMode` / `executePlan` /
  `reviewPlan` paths before applying the chosen action.

**Plan protection.** Choosing _Neuer Schnellplan_ or _Neuer Architekturplan_
while `.agent/plans/current-plan.md` already exists opens a three-option guard:
_Bestehenden Plan archivieren & neu beginnen_ (archives the current file as
`incomplete`, then starts the new plan), _Bestehenden Plan überschreiben_
(replaces it without archiving), or _Abbrechen_ (keeps the existing file). In a
non-interactive context the guard cannot be shown, so `/plan` conservatively
refuses to overwrite and only notifies.

**After a plan is created.** Only the turn that newly creates the plan file
offers a small, non-blocking _Nächster Schritt_ menu: _`/work` starten_,
_`/review-plan` ausführen_, _Todos anzeigen_, or _Im Planmodus bleiben_.
Refinement turns on an existing plan stay menu-free (they only notify that the
plan was saved). Nothing executes automatically — Esc / _Im Planmodus bleiben_
leave the workflow untouched. The menu only appears in the TUI while idle.
The result is finalized from `agent_settled`, after retries, compaction and
queued continuations are finished; `agent_end` never opens UI by itself. Only
an assistant result with terminal `stopReason: "stop"` can finalize a plan,
review, decision or completion; errors, aborts and length truncation stay
retryable and never archive automatically.

Workflow mode, permission level, thinking level, and tool selection remain
fully independent; `/plan` only changes the workflow mode/phase and never
touches permissions.

Mode transitions have no phase or escalation guard, but they protect running
work: selecting the already-active mode while idle is a no-op, and if an agent
turn is active, the switch (as well as `/work`, `/review-plan`, and `/decide`)
first asks _Laufenden Agent-Turn abbrechen?_ before aborting and normalizing
the review/execution state. Declining keeps the turn running and changes
nothing. `/review-plan` is not a mode transition and therefore preserves the
currently selected mode.

## Decision-Intake (Klärmodus)

The Decision-Intake is an **optional, preparatory** step that runs _before_ the
actual planning. It does **not** replace or extend the workflow modes —
`work` / `simple_plan` / `detailed_plan` remain the only permanent modes.
Reaching the intake sets a transient `deciding` phase (analogous to the
`reviewing` phase), starts **no** implementation, and never switches to
`/work` automatically.

Start it via `/decide` or via the _Optionen klären_ action inside `/plan`
(both start the intake immediately), or switch into the Klär-Modus silently
from the Control Center's _Optionen klären_ entry — the intake then begins on your
next message. The agent then clarifies the genuinely decision-relevant questions
using `ask_user` — exactly one focused question per call, 2–4 options each,
with a short meaning/consequence and an explicit recommendation — and ends the
turn with a fenced block:

```text
[DECISION-BRIEF]
# Decision Brief: <task>
## Ziel / ## Nicht-Ziele / ## Gewählte Richtung / ## Entscheidungen /
## Verworfene Optionen / ## Risiken / Constraints / ## Offene Fragen /
## Abschlusskriterien / ## Empfohlener nächster Schritt
[/DECISION-BRIEF]
```

The extension writes that block to `.agent/plans/decision-brief.md` itself
(the same way it writes `current-plan.md`), so the intake works on **every**
permission level — including `read-only`/`read-bash` — without changing the
permission policy. The Decision Brief is a separate artifact; it never
replaces `current-plan.md`.

**Decision budget.** At most **6** decision questions by default, and at most
**8** for larger architectural/workflow/permission/UI/security changes. After
each question the agent checks whether more clarification is truly needed; no
trivia, taste, or context-derivable questions. Anything still open when the
budget is reached is recorded under _Offene Fragen_ instead of asked forever.
The user can cancel at any time and have the Decision Brief written from what
was clarified so far.

**Handoff.** Once a brief is written, a non-blocking menu offers:
_Schnellplan aus Decision Brief erstellen_, _Architekturplan aus Decision Brief
erstellen_, _Nur Decision Brief speichern_, or _Abbrechen_. Choosing a plan
variant only activates `simple_plan`/`detailed_plan` — it starts no turn and
no `/work`. The next plan turn then receives the Decision Brief as context
(respecting the chosen direction, not reopening discarded options, surfacing
open questions, deriving concrete todos) while the final plan is still written
to `.agent/plans/current-plan.md`.

**Protection.** An existing `current-plan.md` is guarded as usual when a plan
is created from a brief. An existing Decision Brief is guarded before a new
intake overwrites it (archive-with-timestamp / overwrite / cancel); there are
no silent data losses.

**Lifecycle.** When the plan is archived (auto-completion, `/done`, or
`/finish`), an existing `decision-brief.md` is archived along with it. A brief
therefore never leaks as stale context into a later, unrelated plan turn;
archive errors are non-fatal (notification only, the plan archive stands).

Permissions, tools, and thinking are fully independent of the Decision-Intake.
The Control Center additionally offers the Klär-Modus as its "Optionen klären"
entry (see "Plan variants" above): selecting it switches **silently** into
`deciding` (no immediate turn, no `mode` change), so the intake prompt only
fires on the next user message. `Ctrl+Shift+Y` stays the permission picker,
and no intake action changes the permission level.

## Permissions

Workflow mode and permission level are independent. Changing
`read-only`, `read-bash`, `read-write`, `full-access` or `yolo` never changes
the active workflow mode, and each level applies the same way in all modes.
`read-only` and `read-bash` retain the explicit
`.agent/plans/current-plan.md` write exception. Permission selection and the
selected level are persisted per session. New sessions start in `read-write`;
a persisted `yolo` level is deliberately reset to `read-write` at session
start, while every other saved level is restored.

| Level         | Effective access                                                                                                       |
| ------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `read-only`   | Project reads; only the current plan file remains writable                                                             |
| `read-bash`   | Project reads, proven read-only Bash commands, and the current plan file                                               |
| `read-write`  | Normal project writes; prompts for risky operations                                                                    |
| `full-access` | Also allows package installs and Git housekeeping; still prompts for deletion, `sudo`, force-push, and external writes |
| `yolo`        | Allows ordinary deletion, `sudo`, force-push, and non-system external writes; hard warnings remain active              |

`git push --force` (including `--force-with-lease`/`-f`) is classified as
sensitive, not as Git housekeeping: it destroys remote history, so
`full-access` still prompts for it and only `yolo` runs it unprompted. Secret
detection targets real secret files (dotfiles such as `.env`/`.ssh`, bare
names such as `credentials`, and data/key extensions such as `auth.json` or
`secrets.yaml`); source-code modules such as `src/auth.ts` or `tokenizer.ts`
no longer trigger hard warnings — false alarms would erode the remaining
warnings' credibility.

Use `/permission <level>` to select a level directly. `/full-access` and
`/yolo` toggle their respective level and return to `read-write` when invoked
again. The explicit plan-file exception at the two read-restricted levels is
unaffected.

`Ctrl+Shift+Y` opens a quick picker containing all five permission levels.
The picker and all permission commands remain available independently of the
workflow mode, plan/review phase, or current idle state. They never change the
workflow mode or abort a running turn.

`full-access` and `yolo` activate directly when selected. The operation-level
hard warnings enforced by the central policy remain unchanged.

`AUTO_YOLO_ON_START` is `false` in `mode-permissions.ts`. Every new session
starts at `read-write`; a resumed session also downgrades a previously saved
`yolo` level to `read-write`. This keeps YOLO exclusively manual via `/yolo`,
`/permission yolo`, or the permission picker.

The central `mode-permissions.ts` extension enforces file, path, Bash and
secret policy. Hard warnings for secrets, system paths, destructive root
operations and similar critical actions remain in place.

## Plan file structure

Only two sections are required: `Auftrag` (the task) and `Todos` (at least
one checkbox). `Nicht-Ziele`, `Betroffene Bereiche`, and `Risiken /
Entscheidungen` are recommended for detailed plans but not enforced. Simple
plans intentionally stay short while writing the same valid minimum structure.

## Optional review

`/review-plan` is completely independent from the primary `/plan → /work`
flow. It can inspect and update the current plan and records a SHA-256 hash
only for review-status bookkeeping. Missing or stale review status never shows
a confirmation and never blocks `/work`.

Invoking `/review-plan` preserves `work`, `simple_plan`, or `detailed_plan`.
The review uses its own temporary phase only while the review turn runs.

## Completion

The checkboxes under `## Todos` are the sole Todo source; an optional numeric
prefix such as `## 5. Todos` is accepted. During execution, the
`plan_progress({ step, status, evidence })` tool records `in_progress`,
`completed`, or `blocked`; `completed` atomically checks the matching Markdown
checkbox. Every status requires a concrete evidence string. `/done <n> [m …]`
remains the idle-only manual fallback. Legacy `[PLAN-PROGRESS]` and `[DONE:n]`
responses are accepted only from successful terminal assistant responses and
must match the active execution hash. As soon as every checkbox is checked,
the plan is archived after the complete agent run has settled under
`.agent/plans/archive/YYYY-MM-DD-HHMM-current-plan.md` with `Status:
complete`, and an existing Decision Brief is archived along with it. If
archiving fails while the plan is still complete, the phase falls back to
`ready`; if the plan changed or contains open todos, execution becomes
`paused`. In both cases the active plan is retained. Invoking `/work` on an
already fully completed plan
offers to archive it directly (confirmation) instead of only pointing at
`/finish`. `/finish` remains available to archive a plan early with open todos
(`Status: incomplete`, requires interactive confirmation) or as that retry
path.

Workflow metadata is stored atomically beside the plan in the versioned
`.agent/plans/current-plan.state.json` sidecar. It includes the plan hash,
phase, mode, review hash, creation mode, and evidence-backed progress records.
The Markdown plan remains authoritative: a missing, invalid, or hash-stale
sidecar is reconstructed conservatively from the plan structure and
checkboxes on session start.

Sidecar CAS conflicts are fail-closed: the losing session does not start a
review, decision or execution turn, reloads the winning revision, and can retry
without restarting the session. An idle `/work` continuation revalidates the
plan hash before reusing its execution ID. Complete archival revalidates hash
and todos while holding the workspace lock. Async confirmations and menus are
bound to the originating session epoch, so results from a replaced session are
ignored. Unreadable plan or Decision-Brief artifacts are never treated as
missing and are not overwritten.

## Permission shortcut

`Ctrl+Shift+Y` opens the permission picker; `/yolo` remains the direct YOLO
toggle. Both change only the permission level, which is visibly marked by the
Zentui `permissions` status segment. On terminals without reliable modified-key reporting, use
`/permission` or `/yolo`; Pi's preferred shortcut requires Kitty/CSI-u or
compatible `modifyOtherKeys` support.

## Restrisiken (bewusste Entscheidungen)

Ein Punkt bleibt als bewusstes Restrisiko bestehen:

- **Planmodi sind Prompt-only.** `simple_plan`/`detailed_plan`/Review/Intake
  verbieten Umsetzung nur über den injizierten Kontext; technisch erzwungen
  wird nichts. Wer echten Schutz beim Planen will, wählt `read-only` oder
  `read-bash` (Plan-Datei bleibt beschreibbar).

## Compaction

`custom-compaction.ts`, which used to enforce a structured summary (Ziele,
Entscheidungen, Betroffene Dateien, Offene Todos, Risiken, Letzter Zustand,
Nächste Schritte) on compaction, was removed during the 2026-07-01
config cleanup. Compaction now uses Pi's default behavior
(`settings.json` → `compaction`); no section structure is enforced.
