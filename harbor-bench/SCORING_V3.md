# SCORING_V3.md — Benchmark v3 (A10)

## Model

0-100, seven weighted categories, exactly as specified in the Benchmark v3
order:

| Category                 | Weight |
| ------------------------ | ------ |
| Functional Correctness   | 45     |
| Regression Safety        | 15     |
| Completeness             | 10     |
| Scope Control            | 10     |
| Verification Quality     | 10     |
| Repository Understanding | 5      |
| Efficiency               | 5      |

Implementation: `postprocess/scoring.py::compute_score()`. Weight sum (100)
is asserted at import time, not just documented, so a future edit cannot
silently drift.

## Hard gate (non-negotiable, per the order's own wording)

> "Ein funktional falscher Run bleibt Fail. Effizienz darf einen falschen
> Fix niemals retten."

`compute_score()` enforces this structurally: if `functional_correctness <
functional_pass_threshold` (default `1.0`), the result is always
`pass_fail=False, total_score=0.0` — no other category's value is even
summed. This is not a suggestion applied after the fact; it is the first
branch in the function.

**Verified against real reference runs** (2026-09-01):
`jobs/t02-nop-check` (no-op agent, `reward=0`) → `functional_correctness=0.0`
→ `total_score=0.0`, `pass_fail=False`. `jobs/t02-oracle-check` (reference
solution, `reward=1`) → `functional_correctness=1.0` plus illustrative
grades on the other six axes → `total_score=95.5`, `pass_fail=True`.

## What this module does NOT do

It is a scoring _model_, not an auto-grader. Only `functional_correctness`
is required input, sourced directly from a task's own verifier
(`reward.txt`/`reward.json`). The other six categories require either
task-specific automated signals (e.g. Verification Quality could partly
derive from A7's `tool_errors`/`project_check` usage once a task defines
what "good" verification behavior looks like for it) or manual/LLM-judge
grading — that grading logic is Teil C/D task-design work, not Teil A
infrastructure. A category left `None` is excluded from the weighted sum,
never silently treated as zero or as the maximum — an incomplete assessment
must show up as incomplete, not as a wrong number.

## Relationship to `benchmarks/SCORING.md` (the older philosophy)

The pre-Harbor P3-P6 benchmark series took an explicit, deliberate
position: _"Kein automatisches Ranking [...] Das ist eine bewusste
Nicht-Ziel-Vorgabe, keine technische Lücke"_ (raw measurements only, no
score formula, human judgment stays primary). Benchmark v3's own order
requires a 0-100 score in addition to pass/fail. This is a **deliberate
methodological change for v3**, made because the order explicitly asks for
it — not a quiet reversal of the older document's reasoning, and not a
claim that the older approach was wrong for its own series. `benchmarks/SCORING.md`
is left untouched as the record of that series' own methodology.

The two documents can coexist because v3's score is explicitly _additional_
to pass/fail, never a replacement for it, and the hard functional-gate
above keeps the same core discipline the older document was protecting
against (a fast, cheap, wrong answer scoring better than a slow, correct
one) — just expressed as a weighted model instead of as an abstention from
scoring altogether.
