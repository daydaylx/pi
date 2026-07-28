/**
 * Plan documents and workflow seeds shared by the regression suites.
 *
 * v1/v2 shapes (validPlan, progressPlan, detailedPlan) still exist because the
 * migration and legacy-rejection tests need them; v3Plan is the current
 * contract.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { importModule } from "./jiti-loader.mjs";

const planSnapshot = await importModule("extensions/plan-mode/plan-snapshot.ts");
const planStore = await importModule("extensions/plan-mode/store/index.ts");

export const validPlan = [
  "# Plan",
  "",
  "## Auftrag",
  "Das Ziel.",
  "",
  "## Todos",
  "- [x] Bereits erledigt",
  "- [ ] Noch offen",
].join("\n");

export const progressPlan = [
  "# Plan",
  "",
  "## Auftrag",
  "Das Ziel.",
  "",
  "## Todos",
  "- [ ] Erster Schritt",
  "- [ ] Zweiter Schritt",
].join("\n");

export const detailedPlan = [
  "# Architekturplan",
  "",
  "## Auftrag",
  "Das Ziel.",
  "",
  "## Nicht-Ziele",
  "Keine Erweiterung außerhalb des Auftrags.",
  "",
  "## Betroffene Bereiche",
  "Plan- und Berechtigungsworkflow.",
  "",
  "## Risiken / Entscheidungen",
  "Die bekannten Risiken.",
  "",
  "## Todos",
  "- [ ] Umsetzung",
  "",
  "## Tests / Checks",
  "Typecheck und Regressionstests.",
  "",
  "## Abschlusskriterien",
  "Alle Tests sind grün.",
].join("\n");

export function v3Plan(steps = ["Implementiere den Adapter"]) {
  return `# Umbauplan

## Ziel
Den Workflow vereinfachen.

## Nicht-Ziele
- Keine Dependency-Änderung

## Gewählte Lösung
PlanSnapshot und Sidecar trennen.

## Annahmen
- Git ist verfügbar

## Umsetzungsschritte
${steps.map((step, index) => `${index + 1}. ${step}`).join("\n")}

## Betroffene Bereiche
- extensions/plan-mode

## Technischer Scope
- extensions/plan-mode/**
- tests/**

## Änderungsregeln
- Nutzeränderungen erhalten

## Risiken
- Migration alter States

## Verifikation
- npm --prefix npm run typecheck

## Abschlusskriterien
- v3-State ist atomar
`;
}

export function makeFailingGateExec() {
  return async (program, args) => {
    const joined = `${program} ${args.join(" ")}`;
    if (args[0] === "status")
      return { code: 0, stdout: " M src/a.ts\n", stderr: "", killed: false };
    if (args[0] === "diff")
      return { code: 0, stdout: "1 file changed", stderr: "", killed: false };
    if (joined.includes("run typecheck"))
      return { code: 1, stdout: "", stderr: "type error", killed: false };
    return { code: 0, stdout: "", stderr: "", killed: false };
  };
}

export function seedFinishableWorkflow(cwd) {
  const finalized = planSnapshot.finalizePlanDocument(
    v3Plan(["Schritt eins"]),
    "simple_plan",
  );
  const initial = planStore.writePlanAndStateCAS(
    cwd,
    finalized.snapshot,
    "missing",
  );
  return planStore.writeWorkflowStateCAS(
    cwd,
    {
      ...initial.state,
      status: "working",
      steps: initial.state.steps.map((step) => ({
        ...step,
        status: "completed",
        evidence: "erledigt",
      })),
    },
    initial.stateToken,
  );
}

/**
 * Direct plan-file access for tests.
 *
 * plan-mode/utils.ts was dissolved with the v2 plan handling; these helpers
 * replace its read/write functions over plain fs.
 */
export const planUtils = {
  PLAN_RELATIVE_PATH: ".agent/plans/current-plan.md",
  readPlanFile(cwd) {
    const file = path.join(cwd, ".agent", "plans", "current-plan.md");
    return existsSync(file) ? readFileSync(file, "utf8") : undefined;
  },
  writePlanFileAtomic(cwd, content) {
    const dir = path.join(cwd, ".agent", "plans");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "current-plan.md"), content, "utf8");
  },
};

/** A minimal but contract-complete quick plan. */
export function quickPlan(step = "Implementiere den Adapter") {
  return `# Umbauplan

## Ziel
Den Workflow vereinfachen.

## Nicht-Ziele
- Keine Dependency-Änderung

## Gewählte Lösung
PlanSnapshot und Sidecar trennen.

## Annahmen
- Git ist verfügbar

## Umsetzungsschritte
1. ${step}
2. Ergänze die Tests

## Betroffene Bereiche
- extensions/plan-mode

## Technischer Scope
- extensions/plan-mode/**
- tests/**

## Änderungsregeln
- Nutzeränderungen erhalten

## Risiken
- Migration alter States

## Verifikation
- npm --prefix npm run typecheck

## Abschlusskriterien
- v3-State ist atomar
`;
}
