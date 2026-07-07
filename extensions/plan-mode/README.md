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
  and the `/decide` entry in the `Ctrl+Shift+X` command menu.
- `/work` (primary) or `/go` (alias): execute the current plan directly. Runs
  independently of whether a review happened. If a plan is already executing,
  a duplicate `/work` call is ignored instead of aborting and restarting it.
- `/review-plan`: optional deep review; worth it for large, risky, or
  architectural changes. It records review status without changing the active
  workflow mode or gating `/work`.
- `/plan-todos`: read progress from the current plan file.
- `/finish`: manual archive/early-abort. Runs automatically once all todos
  are checked off (see "Completion").

## Plan variants

`/plan` is a state-aware assistant (details below). Shift+Tab opens the same
three persistent modes as a mode picker (no permissions, no thinking, no
tools — see `extensions/shared/mode-menu.ts`), plus a fourth, non-persistent
**Optionen klären** entry that starts the Decision-Intake directly from
Shift+Tab; permission levels have their own picker on `Ctrl+Shift+Y` (below).
Internal `WorkflowMode` values are unchanged; only the labels were renamed for
clarity:

- **Schnellplan** (`simple_plan`) — compact questions and a short plan file
  for small to medium tasks.
- **Architekturplan** (`detailed_plan`) — detailed context, risk,
  architecture and implementation analysis using the same plan file.
- **Work** (`work`) — normal work. Selecting Work in Shift+Tab does not
  automatically execute a stored plan; `/work` remains the explicit execution
  command.
- **Optionen klären** (`"decide"`) — not a `WorkflowMode`; selecting it emits
  the same `PLAN_ACTION_REQUEST_EVENT` (`action: "decide"`) as `/decide` and
  the `/plan`/`Ctrl+Shift+X` entries, and does not change `mode`.

## `/plan` plan assistant

`/plan`, `Ctrl+Alt+P`, and the `open-plan-picker` entry in the `Ctrl+Shift+X`
command menu all route through the same assistant. It renders the shared
`runMenu(...)` overlay (with a plain `ctx.ui.select(...)` fallback) and offers
different actions depending on the current state:

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

**After a plan is created.** Once a plan-mode turn leaves a plan file behind,
the assistant optionally offers a small, non-blocking _Nächster Schritt_ menu:
_`/work` starten_, _`/review-plan` ausführen_, _Todos anzeigen_, or _Im
Planmodus bleiben_. Nothing executes automatically — Esc / _Im Planmodus
bleiben_ leave the workflow untouched. The menu only appears in the TUI while
idle.

Workflow mode, permission level, thinking level, and tool selection remain
fully independent; `/plan` only changes the workflow mode/phase and never
touches permissions.

All mode transitions are direct: they have no idle, phase, escalation or
confirmation guard. If an agent turn is active, mode selection aborts and
normalizes the current review/execution state before applying the requested
mode. `/review-plan` is not a mode transition and therefore preserves the
currently selected mode.

## Decision-Intake (Klärmodus)

The Decision-Intake is an **optional, preparatory** step that runs _before_ the
actual planning. It does **not** replace or extend the workflow modes —
`work` / `simple_plan` / `detailed_plan` remain the only permanent modes.
Reaching the intake sets a transient `deciding` phase (analogous to the
`reviewing` phase), starts **no** implementation, and never switches to
`/work` automatically.

Start it either via `/decide` or via the _Optionen klären_ action inside
`/plan`. The agent then clarifies the genuinely decision-relevant questions
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

Permissions, tools, and thinking are fully independent of the Decision-Intake.
Shift+Tab additionally offers the intake as its "Optionen klären" entry (see
"Plan variants" above) but this never changes `mode`, `Ctrl+Shift+Y` stays the
permission picker, and no intake action changes the permission level.

## Permissions

Workflow mode and permission level are independent. Changing
`read-only`, `read-bash`, `read-write`, `full-access` or `yolo` never changes
the active workflow mode, and each level applies the same way in all modes.
`read-only` and `read-bash` retain the explicit
`.agent/plans/current-plan.md` write exception. Permission selection and the
existing `/write` override are persisted per session. For the three writable
levels, a restrictive `/write` override takes precedence; `read-only` and
`read-bash` always retain their current-plan-file exception.

| Level         | Effective access                                                                                           |
| ------------- | ---------------------------------------------------------------------------------------------------------- |
| `read-only`   | Project reads; only the current plan file remains writable                                                 |
| `read-bash`   | Project reads, proven read-only Bash commands, and the current plan file                                   |
| `read-write`  | Normal project writes; prompts for risky operations                                                        |
| `full-access` | Also allows package installs and Git housekeeping; still prompts for deletion, `sudo`, and external writes |
| `yolo`        | Allows ordinary deletion, `sudo`, and non-system external writes; hard warnings remain active              |

Use `/permission <level>` to select a level directly. `/full-access` and
`/yolo` toggle their respective level and return to `read-write` when invoked
again. `/write allow|block|plan-only` independently restores normal writes,
blocks writes governed by the override, or restricts them to the current plan
file. The explicit plan-file exception at the two read-restricted levels is
unaffected.

`Ctrl+Shift+Y` opens a quick picker containing all five permission levels.
The picker and all permission commands remain available independently of the
workflow mode, plan/review phase, or current idle state. They never change the
workflow mode or abort a running turn.

`CONFIRM_ELEVATED_PERMISSIONS` is currently disabled in
`mode-permissions.ts`, so `full-access` and `yolo` activate directly. The
operation-level hard warnings enforced by the central policy remain unchanged.

`AUTO_YOLO_ON_START` is currently enabled in `mode-permissions.ts`. A session
without persisted permission state therefore starts in `yolo`; a resumed or
reloaded session restores its latest saved permission level and `/write`
override. Set that constant to `false` to make new sessions start in
`read-write`.

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
prefix such as `## 5. Todos` is accepted. During execution, `[DONE:n]` updates
checkbox `n` atomically in the plan file. As soon as every checkbox is
checked, the plan is archived automatically under
`.agent/plans/archive/YYYY-MM-DD-HHMM-current-plan.md` with `Status:
complete`. If archiving fails, the phase falls back to `ready` and `/finish`
can be run manually as a retry. `/finish` remains available to archive a plan
early with open todos (`Status: incomplete`, requires interactive
confirmation) or as that retry path.

## Permission shortcut

`Ctrl+Shift+Y` opens the permission picker; `/yolo` remains the direct YOLO
toggle. Both change only the permission level, which is visibly marked in the
footer. On terminals without reliable modified-key reporting, use
`/permission` or `/yolo`; Pi's preferred shortcut requires Kitty/CSI-u or
compatible `modifyOtherKeys` support.

## Compaction

`custom-compaction.ts`, which used to enforce a structured summary (Ziele,
Entscheidungen, Betroffene Dateien, Offene Todos, Risiken, Letzter Zustand,
Nächste Schritte) on compaction, was removed during the 2026-07-01
config cleanup. Compaction now uses Pi's default behavior
(`settings.json` → `compaction`); no section structure is enforced.
