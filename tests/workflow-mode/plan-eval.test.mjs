/**
 * Tests the plan evaluator itself.
 *
 * An evaluation suite that cannot tell a good plan from a bad one is worse than
 * none: it reports a number that nobody can act on. These cases pin the
 * discrimination the scorer is supposed to have, using the bundled reference
 * plans, and pin the separation between mechanical and judgement criteria.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { assert, eq, test } from "../shared/assertions.mjs";
import { EVAL_TASKS } from "../plan-eval/tasks.mjs";
import {
  JUDGEMENT_CRITERIA,
  MECHANICAL_CRITERIA,
  scorePlan,
} from "../plan-eval/score.mjs";

const fixtures = fileURLToPath(new URL("../plan-eval/fixtures/", import.meta.url));
const fixture = (name) => readFileSync(join(fixtures, name), "utf8");
const task = (id) => EVAL_TASKS.find((entry) => entry.id === id);

await test("the eval corpus covers the required task kinds", () => {
  assert(
    EVAL_TASKS.length >= 6 && EVAL_TASKS.length <= 10,
    `the suite stays small enough to maintain (${EVAL_TASKS.length} tasks)`,
  );
  const kinds = EVAL_TASKS.map((entry) => entry.kind).join(" | ");
  for (const required of [
    "bekannte kleine Änderung",
    "unbekannter Bug",
    "Multi-Datei-Feature",
    "Architekturänderung",
    "Security-/Permission-Aufgabe",
    "Migration",
    "ungeeignete Aufgabe",
  ]) {
    assert(kinds.includes(required), `the corpus covers "${required}"`);
  }
  const ids = new Set(EVAL_TASKS.map((entry) => entry.id));
  eq(ids.size, EVAL_TASKS.length, "task ids are unique");
});

await test("the scorer separates a good plan from an overblown one", () => {
  const small = task("known-small-change");
  const good = scorePlan(small, fixture("known-small-change.good.md"));
  const bad = scorePlan(small, fixture("known-small-change.bad.md"));

  eq(
    good.mechanicalPassed,
    good.mechanicalTotal,
    "the good plan passes every mechanical criterion",
  );
  assert(
    bad.mechanicalPassed < good.mechanicalPassed,
    "the overblown plan scores strictly worse",
  );
  assert(
    !bad.results["surface-hit"].pass,
    "and is caught missing the file it would actually have to change",
  );
  assert(
    !bad.results["surface-creep"].pass,
    "and caught dragging in permissions and the GUI",
  );
  assert(
    !bad.results.proportionality.pass,
    "and caught inventing phases for a one-file change",
  );
  assert(
    !bad.results.verification.pass,
    '"Wird geprüft." is not a verification',
  );
});

await test("a plan that declares itself unnecessary still scores well", () => {
  const score = scorePlan(
    task("plan-mode-unnecessary"),
    fixture("plan-mode-unnecessary.good.md"),
  );
  eq(
    score.mechanicalPassed,
    score.mechanicalTotal,
    "saying the plan mode is not needed is a good plan, not a failed one",
  );
});

await test("judgement criteria are reported but never scored mechanically", () => {
  const score = scorePlan(
    task("known-small-change"),
    fixture("known-small-change.good.md"),
  );
  for (const name of JUDGEMENT_CRITERIA) {
    eq(
      score.judgement[name],
      "unbewertet",
      `${name} is left to a reviewer instead of being guessed`,
    );
    assert(
      !MECHANICAL_CRITERIA.includes(name),
      `${name} is not silently folded into the mechanical score`,
    );
  }
  eq(
    score.mechanicalTotal,
    MECHANICAL_CRITERIA.length,
    "the mechanical total counts exactly the mechanical criteria",
  );
});

await test("the architecture-plan criteria only apply to architecture plans", () => {
  const quick = scorePlan(
    task("known-small-change"),
    fixture("known-small-change.good.md"),
  );
  assert(
    quick.results["non-goals"].pass && quick.results.acceptance.pass,
    "a quick plan is not penalised for omitting non-goals or acceptance criteria",
  );
  const asArchitecture = scorePlan(
    { ...task("known-small-change"), mode: "detailed_plan", expectPhases: true },
    fixture("known-small-change.good.md"),
  );
  assert(
    !asArchitecture.results["non-goals"].pass &&
      !asArchitecture.results.acceptance.pass,
    "the same text judged as an architecture plan fails those criteria",
  );
});
