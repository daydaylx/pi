# Plan workflow extension

The extension implements a guarded workflow:

```text
/plan → /review-plan → /go → /finish
```

## Commands

- `/plan` or `Ctrl+Alt+P`: toggle planning tools.
- `/review-plan`: run an agent review and approve the resulting plan hash.
- `/go`: execute the reviewed, unchanged plan.
- `/work`: alias for `/go`.
- `/plan-todos`: read progress from the current plan file.
- `/finish`: archive the plan and clear the workflow state.

## Planning and review

Planning is read-only except for `.agent/plans/current-plan.md`. Paths are
resolved against Pi's current working directory and must exactly match that
file. Existing symbolic-link components are rejected.

If a material decision has multiple valid answers, the agent must use
`ask_user` before finalizing or approving the plan. A review succeeds only when
the agent emits `[PLAN-REVIEW:APPROVED]` and the plan contains the required
sections and at least one Todo. `/go` compares the current file with the
reviewed SHA-256 hash, so any later edit requires another review.

## Todos and completion

The checkboxes in section `## 8. Umsetzungsschritte / Todos` are the sole Todo
source. During execution, `[DONE:n]` updates checkbox `n` atomically in the plan
file. Session state stores only the workflow phase and reviewed hash.

`/finish` writes the plan to
`.agent/plans/archive/YYYY-MM-DD-HHMM-current-plan.md` before removing the
current file. Name collisions receive a numeric suffix. Incomplete plans
require explicit confirmation and are archived with status `incomplete`.
`.agent/plans/` is local workflow state and is ignored by this repository.

## Compaction

`custom-compaction.ts`, which used to enforce a structured summary (Ziele,
Entscheidungen, Betroffene Dateien, Offene Todos, Risiken, Letzter Zustand,
Nächste Schritte) on compaction, was removed during the 2026-07-01
config cleanup. Compaction now uses Pi's default behavior
(`settings.json` → `compaction`); no section structure is enforced.
