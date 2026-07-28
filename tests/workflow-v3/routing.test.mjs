/**
 * Modell-Routing: deterministische Einstufung low/standard/high.
 *
 * Testet die reine Routing-API (assess/decide/profiles/format/compute) plus die
 * Invarianten, die der Arbeitsauftrag verlangt: harte HIGH-Regeln sind nicht
 * durch Punktzahl, Konfiguration oder manuellen Override umgehbar; manuelle
 * Hochstufung funktioniert; LOW überspringt Plan/Review nur unter erlaubten
 * Bedingungen; die Entscheidung ist unveränderlich; Workflow-Statuswerte
 * bleiben unangetastet; keine Modellnamen in der Fachlogik.
 */
import { assert, eq, test } from "./assertions.mjs";
import { load } from "./harness.mjs";

const routing = await load("extensions/plan-mode/routing/index.ts");
const workflowStatus = await load("extensions/shared/workflow-status.ts");

function input(partial = {}) {
  return {
    taskText: "",
    scopePaths: [],
    affectedAreas: [],
    verification: [],
    ...partial,
  };
}

function route(partial, config) {
  return routing.computeRouting(input(partial), config);
}

await test("routing classifies low-risk work as LOW", () => {
  const doc = route({
    taskText: "Tippfehler in der README korrigieren",
    scopePaths: ["README.md"],
    verification: ["typecheck"],
  });
  eq(doc.level, "low", "doc change is low");
  eq(doc.plannerRequired, false, "low needs no plan");
  eq(doc.reviewerRequired, false, "low with verification may skip review");

  const bug = route({
    taskText: "Kleinen Bug in formatValue beheben",
    scopePaths: ["src/util.ts"],
    verification: ["test"],
  });
  eq(bug.level, "low", "isolated bug is low");
});

await test("routing classifies multi-module API work as STANDARD", () => {
  const feature = route({
    taskText: "Lokales Feature, erweitert eine öffentliche Schnittstelle",
    scopePaths: ["extensions/a.ts", "tests/b.ts"],
    verification: ["typecheck", "test"],
  });
  assert(
    feature.level === "standard" || feature.level === "high",
    "feature across modules with an API is at least standard",
  );
  eq(feature.plannerRequired, true, "standard needs a plan");
  eq(feature.reviewerRequired, true, "standard needs a review");
});

await test("routing classifies architecture work as HIGH", () => {
  const arch = route({
    taskText: "Architektur-Redesign des Subsystems mit neuer API",
    scopePaths: ["extensions/a.ts", "extensions/b.ts", "tests/c.ts"],
    affectedAreas: ["core", "ui"],
    verification: ["typecheck"],
  });
  eq(arch.level, "high", "rich architecture signals reach high");
});

await test("routing forces HIGH for hard risk categories", () => {
  for (const partial of [
    { taskText: "Migration der Nutzdaten" },
    { taskText: "Permission-Modell anpassen" },
    { taskText: "Secret-Handling ändern" },
    { taskText: "CAS und parallele Schreibzugriffe" },
    { taskText: "Workflow-State-Logik umbauen" },
    { taskText: "Completion-Entscheidung verschieben" },
    { taskText: "Runtime-Patch mit systemweiter Wirkung" },
  ]) {
    const decision = route(partial);
    eq(decision.level, "high", `${partial.taskText} must be HIGH`);
    assert(
      decision.evidence.hardHighReasons.length > 0,
      "hard HIGH reasons are recorded",
    );
  }
});

await test("hard HIGH rules ignore the score and the config", () => {
  // Minimal signals that would normally score low, but the keyword forces HIGH.
  const decision = route({ taskText: "Secret", verification: ["typecheck"] });
  eq(decision.level, "high", "hard HIGH beats a low score");

  // A config cannot lower the level — it only swaps profile labels.
  const lowConfig = {
    levels: {
      low: { worker: "cheap" },
      standard: { worker: "mid" },
      high: { worker: "mid" },
    },
  };
  const withConfig = route({ taskText: "Migration" }, lowConfig);
  eq(withConfig.level, "high", "config never downgrades a hard HIGH");
});

await test("manual downgrade of a hard HIGH case is refused", () => {
  const decision = route({ taskText: "Permission", manualLevel: "low" });
  eq(decision.level, "high", "downgrade is refused");
  eq(decision.manuallyEscalated, false, "no escalation recorded");
  assert(
    typeof decision.downgradeBlocked === "string" &&
      decision.downgradeBlocked.length > 0,
    "the refusal is surfaced",
  );
});

await test("manual upgrade works", () => {
  const decision = route({
    taskText: "Tippfehler",
    scopePaths: ["README.md"],
    verification: ["typecheck"],
    manualLevel: "high",
  });
  eq(decision.level, "high", "upgrade raises the level");
  eq(decision.manuallyEscalated, true, "escalation is recorded");
});

await test("profiles are swappable and fall back safely", () => {
  const custom = route(
    {
      taskText: "Schnittstelle erweitern",
      scopePaths: ["a.ts", "b.ts"],
      verification: ["test"],
    },
    {
      levels: {
        low: { worker: "w-low" },
        standard: { planner: "p", worker: "w", reviewer: "r" },
        high: { planner: "p", worker: "w", reviewer: "r" },
      },
    },
  );
  // standard or high, both carry the custom worker in this config.
  eq(custom.workerProfile, "w", "custom profile is used");

  // An empty/invalid levels map falls back to the documented built-ins.
  const fallback = routing.resolveProfiles("high", { levels: {} });
  eq(
    fallback.workerProfile,
    routing.DEFAULT_ROUTING_PROFILES.levels.high.worker,
    "invalid config uses the documented fallback",
  );
});

await test("no model name is hardcoded in routing", () => {
  for (const level of ["low", "standard", "high"]) {
    const profile = routing.DEFAULT_ROUTING_PROFILES.levels[level];
    for (const value of Object.values(profile)) {
      assert(
        typeof value === "string" && value.length > 0 && !value.includes("/"),
        `profile label for ${level} is a plain label, not a provider/model id`,
      );
    }
  }
  const summary = routing.formatRoutingSummary(
    route({ taskText: "Schnittstelle", scopePaths: ["a.ts", "b.ts"] }),
  );
  assert(!summary.includes("claude"), "summary contains no model name");
  assert(!summary.includes("/"), "summary contains no provider/model id");
});

await test("roles receive the chosen profiles per level", () => {
  const high = routing.DEFAULT_ROUTING_PROFILES.levels.high;
  const decision = route({ taskText: "Migration" });
  eq(decision.plannerProfile, high.planner, "high planner profile");
  eq(decision.workerProfile, high.worker, "high worker profile");
  eq(decision.reviewerProfile, high.reviewer, "high reviewer profile");
});

await test("LOW skips plan and review only under allowed conditions", () => {
  const withChecks = route({
    taskText: "Doc fix",
    scopePaths: ["README.md"],
    verification: ["typecheck"],
  });
  eq(withChecks.plannerRequired, false, "low skips planning");
  eq(withChecks.reviewerRequired, false, "low with checks may skip review");

  const withoutChecks = route({
    taskText: "Doc fix",
    scopePaths: ["README.md"],
  });
  eq(
    withoutChecks.reviewerRequired,
    true,
    "low without declared verification keeps a review",
  );
});

await test("the decision is immutable", () => {
  const decision = route({ taskText: "Migration" });
  assert(Object.isFrozen(decision), "decision is frozen");
  assert(Object.isFrozen(decision.evidence), "evidence is frozen");
  assert(
    Object.isFrozen(decision.evidence.hardHighReasons),
    "evidence arrays are frozen",
  );
});

await test("routing adds no WorkflowStatus value", () => {
  eq(
    [...workflowStatus.WORKFLOW_STATUSES],
    ["idle", "planning", "working", "reviewing", "paused", "blocked", "done"],
    "the canonical WorkflowStatus is unchanged",
  );
});

await test("routing summary is compact and covers all fields", () => {
  const summary = routing.formatRoutingSummary(
    route({ taskText: "Migration", scopePaths: ["db.ts"] }),
  );
  assert(summary.includes("Routing: HIGH"), "summary states the level");
  assert(summary.includes("Hartes HIGH-Risiko"), "summary states hard reasons");
  assert(summary.includes("Review:"), "summary states review duty");
  assert(summary.includes("Worker="), "summary states profiles");
});

await test("routing metrics project to a neutral report shape", () => {
  const decision = route({ taskText: "Migration" });
  const metrics = routing.routingMetrics(decision);
  eq(metrics.level, "high");
  eq(metrics.manuallyEscalated, false);
  assert(
    !("evidence" in metrics) && !("plannerRequired" in metrics),
    "metrics carry no evidence or phase flags",
  );
});

await test("plan and direct-task inputs map their scope", () => {
  const planInput = routing.routingInputFromPlan({
    goal: "Migration",
    technicalScope: ["db.ts"],
    affectedAreas: ["persistenz"],
    planType: "detailed_plan",
    verification: ["typecheck"],
  });
  eq(planInput.scopePaths, ["db.ts"]);
  eq(planInput.planType, "detailed_plan");

  const taskInput = routing.routingInputFromDirectTask({
    goal: "Permission fix",
    technicalScope: ["perm.ts"],
    verification: ["test"],
  });
  eq(taskInput.scopePaths, ["perm.ts"]);
});
