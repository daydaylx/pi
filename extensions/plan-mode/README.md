# Plan workflow extension

The extension implements a lightweight workflow:

```text
/plan → /work
```

`/review-plan` and `/finish` are optional/automatic complements, not required
steps.

## Commands

- `/plan` or `Ctrl+Alt+P`: opens a chooser between **Einfacher Plan**
  (light, inline, no plan file) and **Ausführlicher Plan**. The selected mode
  remains active until another mode is chosen. Without an interactive TUI it
  falls back to the detailed plan mode.
- `/work` (primary) or `/go` (alias): execute the current plan directly. Runs
  even if no review happened. The mode transition itself is immediate; see
  "Gating" below for the separate stale-review check.
- `/review-plan`: optional deep review; worth it for large, risky, or
  architectural changes. Approves the plan and records a SHA-256 hash.
- `/plan-todos`: read progress from the current plan file.
- `/finish`: manual archive/early-abort. Runs automatically once all todos
  are checked off (see "Completion").

## Plan variants

`/plan` is a router. Shift+Tab exposes the same two persistent modes alongside
Work and the current permission levels:

- **Einfacher Plan** (`simple_plan`) — compact questions and a slim inline
  plan for small to medium tasks. It does not create a plan file.
- **Ausführlicher Plan** (`detailed_plan`) — detailed context, risk,
  architecture and implementation analysis using the existing plan file.
- **Work** (`work`) — normal work. Selecting Work in Shift+Tab does not
  automatically execute a stored plan; `/work` remains the explicit execution
  command.

All mode transitions are direct: they have no idle, phase, escalation or
confirmation guard. If an agent turn is active it is aborted, running
review/execution state is normalized, and the requested mode replaces it.

## Permissions

Workflow mode and permission level are independent. Changing
`read-only`, `read-bash`, `read-write`, `full-access` or `yolo` never changes
the active workflow mode, and each level applies the same way in all modes.
`read-only` and `read-bash` retain the explicit
`.agent/plans/current-plan.md` write exception. Permission selection and the
existing `/write` override are persisted per session.

The central `mode-permissions.ts` extension enforces file, path, Bash and
secret policy. Hard warnings for secrets, system paths, destructive root
operations and similar critical actions remain in place.

## Detailed planning

Only two sections are required: `Auftrag` (the task) and `Todos` (at least
one checkbox). `Nicht-Ziele`, `Betroffene Bereiche`, and `Risiken /
Entscheidungen` are recommended in the prompt template but not enforced.

## Gating

`/work` distinguishes two cases:

- **Never reviewed**: a plain informational notice is shown; execution
  proceeds regardless of interactive/non-interactive mode. No block, no
  dialog required.
- **Reviewed, then changed**: the SHA-256 hash recorded by `/review-plan` no
  longer matches the file. This is treated strictly, same as before —
  interactive sessions get a confirmation dialog, non-interactive sessions
  block and point back to `/review-plan`. This hash-based protection now
  only applies to plans that went through a review at some point; plans
  that skipped review entirely are never gated by it.

## Completion

The checkboxes under `## 5. Todos` are the sole Todo source. During
execution, `[DONE:n]` updates checkbox `n` atomically in the plan file. As
soon as every checkbox is checked, the plan is archived automatically under
`.agent/plans/archive/YYYY-MM-DD-HHMM-current-plan.md` with `Status:
complete`. If archiving fails, the phase falls back to `ready` and `/finish`
can be run manually as a retry. `/finish` remains available to archive a
plan early with open todos (`Status: incomplete`, requires interactive
confirmation) or as that retry path.

## YOLO

`/yolo` or `Ctrl+Shift+Y` changes only the permission level and visibly marks
the footer. The selected level survives resume/reload of the same session.
On terminals without reliable modified-key reporting, use `/yolo`; Pi's
preferred shortcut requires Kitty/CSI-u or compatible `modifyOtherKeys`
support.

## Compaction

`custom-compaction.ts`, which used to enforce a structured summary (Ziele,
Entscheidungen, Betroffene Dateien, Offene Todos, Risiken, Letzter Zustand,
Nächste Schritte) on compaction, was removed during the 2026-07-01
config cleanup. Compaction now uses Pi's default behavior
(`settings.json` → `compaction`); no section structure is enforced.
