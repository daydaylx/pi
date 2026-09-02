"""A10: 0-100 scoring model, additional to (not a replacement for) pass/fail.

Weights exactly as specified in the Benchmark v3 order: Functional
Correctness 45, Regression Safety 15, Completeness 10, Scope Control 10,
Verification Quality 10, Repository Understanding 5, Efficiency 5 (sums to
100, enforced by an assertion below so a future edit cannot silently drift).

Hard rule (also from the order, non-negotiable): "Ein funktional falscher
Run bleibt Fail. Effizienz darf einen falschen Fix niemals retten." --
`compute_score()` enforces this as a gate, not a suggestion: if
`functional_correctness` is below `functional_pass_threshold`, the result is
always `pass_fail=False, total_score=0.0`, regardless of every other
category's value.

This module defines the MODEL, not an auto-grader: `functional_correctness`
must come from the task's own verifier (e.g. `reward.txt`/`reward.json`);
most other categories require task-specific or manual judgment (Teil C/D
task design), not something derivable from telemetry alone for an arbitrary
task. Fields left `None` are excluded from the weighted sum (not assumed
zero) -- an incomplete assessment must not silently understate the score.

See SCORING_V3.md for the relationship to the older, deliberately
score-free `benchmarks/SCORING.md` philosophy.
"""

from enum import StrEnum

from pydantic import BaseModel


class ScoreCategory(StrEnum):
    functional_correctness = "functional_correctness"
    regression_safety = "regression_safety"
    completeness = "completeness"
    scope_control = "scope_control"
    verification_quality = "verification_quality"
    repository_understanding = "repository_understanding"
    efficiency = "efficiency"


CATEGORY_WEIGHTS: dict[ScoreCategory, int] = {
    ScoreCategory.functional_correctness: 45,
    ScoreCategory.regression_safety: 15,
    ScoreCategory.completeness: 10,
    ScoreCategory.scope_control: 10,
    ScoreCategory.verification_quality: 10,
    ScoreCategory.repository_understanding: 5,
    ScoreCategory.efficiency: 5,
}
assert sum(CATEGORY_WEIGHTS.values()) == 100, "Category weights must sum to 100"


class ScoreInputs(BaseModel):
    """Each field is a 0.0-1.0 grade for that category, or `None` if not yet
    judged. `functional_correctness` is the only field every task MUST
    supply (from its own verifier's reward) -- everything else is optional
    at this stage, to be filled in as Teil C/D task graders are built."""

    functional_correctness: float
    regression_safety: float | None = None
    completeness: float | None = None
    scope_control: float | None = None
    verification_quality: float | None = None
    repository_understanding: float | None = None
    efficiency: float | None = None
    notes: dict[str, str] = {}


class ScoreResult(BaseModel):
    pass_fail: bool
    total_score: float
    category_scores: dict[str, float]  # weighted contribution per graded category
    category_weights: dict[str, int]
    functional_gate_applied: bool  # True iff the hard fail-gate fired


def compute_score(
    inputs: ScoreInputs,
    *,
    functional_pass_threshold: float = 1.0,
) -> ScoreResult:
    weights_by_name = {cat.value: weight for cat, weight in CATEGORY_WEIGHTS.items()}
    functional_pass = inputs.functional_correctness >= functional_pass_threshold

    if not functional_pass:
        # Hard gate: no category, however high, changes this outcome.
        return ScoreResult(
            pass_fail=False,
            total_score=0.0,
            category_scores={},
            category_weights=weights_by_name,
            functional_gate_applied=True,
        )

    category_scores: dict[str, float] = {}
    total = 0.0
    for category, weight in CATEGORY_WEIGHTS.items():
        value = getattr(inputs, category.value)
        if value is None:
            continue
        contribution = value * weight
        category_scores[category.value] = round(contribution, 2)
        total += contribution

    return ScoreResult(
        pass_fail=True,
        total_score=round(total, 2),
        category_scores=category_scores,
        category_weights=weights_by_name,
        functional_gate_applied=False,
    )
