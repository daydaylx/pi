#!/usr/bin/env node
/**
 * Runs the plan evaluation.
 *
 * Without arguments it scores the bundled reference plans, which is what makes
 * the scorer itself testable offline. Pointed at a directory of generated plans
 * (`--plans <dir>`, one `<task-id>.md` per task) it scores a real run.
 *
 * A live run against a provider is deliberately *not* wired in here: no
 * provider credentials belong in a test runner, and the corpus plus the scoring
 * are the reusable part. `docs/plan-eval.md` describes how to produce the plan
 * files for a live run.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { EVAL_TASKS } from "./tasks.mjs";
import { formatReport, scorePlan } from "./score.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));

function plansFrom(dir) {
  const found = new Map();
  if (!existsSync(dir)) {
    console.error(`Kein Plan-Verzeichnis: ${dir}`);
    process.exit(2);
  }
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".md")) continue;
    found.set(name.slice(0, -3), readFileSync(join(dir, name), "utf8"));
  }
  return found;
}

function referencePlans() {
  const dir = join(here, "fixtures");
  const found = new Map();
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".good.md")) continue;
    found.set(
      name.slice(0, -".good.md".length),
      readFileSync(join(dir, name), "utf8"),
    );
  }
  return found;
}

const dirIndex = process.argv.indexOf("--plans");
const plans =
  dirIndex >= 0 ? plansFrom(process.argv[dirIndex + 1]) : referencePlans();

const scores = [];
const missing = [];
for (const task of EVAL_TASKS) {
  const plan = plans.get(task.id);
  if (plan === undefined) {
    missing.push(task.id);
    continue;
  }
  scores.push(scorePlan(task, plan));
}

console.log(formatReport(scores));
if (missing.length > 0) {
  console.log(
    `\nOhne Plan und daher nicht bewertet (${missing.length}/${EVAL_TASKS.length}): ${missing.join(", ")}.`,
  );
  console.log(
    "Für einen vollständigen Lauf je Aufgabe eine <task-id>.md erzeugen und mit --plans <dir> bewerten.",
  );
}
