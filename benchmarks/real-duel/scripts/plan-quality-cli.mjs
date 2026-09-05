#!/usr/bin/env node
/**
 * Duenne CLI um tests/plan-eval/quality-bridge.mjs, damit die Python-Treiber
 * in benchmarks/real-duel/scripts/ denselben Quality-Gate pruefen koennen, den
 * das Produkt selbst durchsetzt (extensions/plan-mode/plan-quality.ts), ohne
 * ihn erneut zu implementieren.
 *
 * usage: node plan-quality-cli.mjs <simple_plan|detailed_plan> <plan-datei>
 * stdout: {"ok": bool, "issues": [{code, message}, ...]}
 * exit code: 0 wenn ok, sonst 1 (2 bei Aufrufsfehler)
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { assessPlanQuality } from "../../../tests/plan-eval/quality-bridge.mjs";

const here = dirname(fileURLToPath(import.meta.url));
void here; // nur zur Doku des Aufloesungswegs, keine Nutzung noetig

const [, , mode, planPath] = process.argv;
if (!mode || !planPath) {
  console.error(
    "usage: plan-quality-cli.mjs <simple_plan|detailed_plan> <plan-datei>",
  );
  process.exit(2);
}

let plan;
try {
  plan = readFileSync(planPath, "utf8");
} catch (error) {
  console.error(`Plan-Datei nicht lesbar: ${planPath}: ${error.message}`);
  process.exit(2);
}

const result = assessPlanQuality(mode, plan);
console.log(JSON.stringify(result));
process.exit(result.ok ? 0 : 1);
