# Plan workflow extension

The extension implements a lightweight workflow:

```text
/plan → /work
```

`/review-plan` and `/finish` are optional/automatic complements, not required
steps.

## Commands

- `/plan` or `Ctrl+Alt+P`: toggle planning tools.
- `/work` (primary) or `/go` (alias): execute the current plan directly. Runs
  even if no review happened — see "Gating" below.
- `/review-plan`: optional deep review; worth it for large, risky, or
  architectural changes. Approves the plan and records a SHA-256 hash.
- `/plan-todos`: read progress from the current plan file.
- `/finish`: manual archive/early-abort. Runs automatically once all todos
  are checked off (see "Completion").

## Planning

Planning is read-only except for `.agent/plans/current-plan.md`. Paths are
resolved against Pi's current working directory and must exactly match that
file. Existing symbolic-link components are rejected.

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

## Compaction

`custom-compaction.ts`, which used to enforce a structured summary (Ziele,
Entscheidungen, Betroffene Dateien, Offene Todos, Risiken, Letzter Zustand,
Nächste Schritte) on compaction, was removed during the 2026-07-01
config cleanup. Compaction now uses Pi's default behavior
(`settings.json` → `compaction`); no section structure is enforced.
