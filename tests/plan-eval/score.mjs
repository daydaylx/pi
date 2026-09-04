/**
 * Scoring for the plan evaluation corpus.
 *
 * The split is deliberate and load-bearing: everything that can be decided by
 * looking at the text is decided here, mechanically and repeatably. Only the
 * criteria that genuinely require judgement are left to a reviewer, and those
 * are reported separately so a model's opinion can never quietly stand in for
 * a fact. A judge that is allowed to overrule "does this plan name the file it
 * changes?" is a judge that will eventually be wrong about it.
 */
import { assessPlanQuality } from "./quality-bridge.mjs";

/** Criteria a program can settle from the plan text and the task definition. */
export const MECHANICAL_CRITERIA = [
  "structure",
  "surface-hit",
  "surface-creep",
  "verification",
  "acceptance",
  "risks",
  "non-goals",
  "proportionality",
];

/** Criteria that need a human or, separately reported, a model reviewer. */
export const JUDGEMENT_CRITERIA = [
  "repository-facts-correct",
  "sensible-questions",
  "actually-implementable",
];

function sections(plan) {
  const found = new Map();
  let current;
  for (const line of plan.split(/\r?\n/)) {
    const heading = /^#{1,6}\s+(.*\S)\s*$/.exec(line);
    if (heading) {
      current = heading[1].toLowerCase();
      found.set(current, "");
      continue;
    }
    if (current) found.set(current, `${found.get(current)}${line}\n`);
  }
  return found;
}

function sectionMatching(plan, needle) {
  for (const [heading, body] of sections(plan)) {
    if (heading.includes(needle)) return body;
  }
  return undefined;
}

function mentionsAny(plan, paths) {
  return paths.filter((path) => plan.includes(path));
}

/** Rough proxy for "did this plan grow phases": numbered or named phases. */
function phaseCount(plan) {
  const body = sectionMatching(plan, "umsetzung") ?? plan;
  const named = body.match(/(?:^|\n)\s*(?:[-*+]\s+|#{3,6}\s+)?Phase\s*\d/gi);
  return named ? named.length : 0;
}

/**
 * Score one plan against one task. Returns a per-criterion verdict plus the
 * mechanical total; judgement criteria are listed but never scored here.
 */
export function scorePlan(task, plan) {
  const results = {};
  const quality = assessPlanQuality(task.mode, plan);
  results.structure = {
    pass: quality.ok,
    detail: quality.ok
      ? "erfüllt die Mindestanforderungen des Modus"
      : quality.issues.map((issue) => issue.message).join(" | "),
  };

  const hit = mentionsAny(plan, task.expectedSurface);
  results["surface-hit"] = {
    pass: hit.length === task.expectedSurface.length,
    detail:
      task.expectedSurface.length === 0
        ? "keine Pflichtdateien definiert"
        : `${hit.length}/${task.expectedSurface.length} erwartete Pfade genannt${
            hit.length === task.expectedSurface.length
              ? ""
              : `; fehlt: ${task.expectedSurface
                  .filter((path) => !hit.includes(path))
                  .join(", ")}`
          }`,
  };

  const creep = mentionsAny(plan, task.forbiddenSurface);
  results["surface-creep"] = {
    pass: creep.length === 0,
    detail:
      creep.length === 0
        ? "keine sachfremden Bereiche gezogen"
        : `zieht unnötig hinein: ${creep.join(", ")}`,
  };

  const verification = sectionMatching(plan, "verifikation") ?? "";
  const hasConcreteCheck =
    /\b(npm|node|pnpm|yarn|tsc|test|typecheck|lint)\b/i.test(verification);
  const hasExpectation = /\b(grün|erwart|schlägt fehl|fail|pass)\w*/i.test(
    verification,
  );
  results.verification = {
    pass: hasConcreteCheck && hasExpectation,
    detail: hasConcreteCheck
      ? hasExpectation
        ? "konkrete Prüfung mit erwartetem Ergebnis"
        : "Prüfung genannt, aber ohne erwartetes Ergebnis"
      : "keine konkret ausführbare Prüfung genannt",
  };

  const acceptance = sectionMatching(plan, "abschlusskriterien");
  results.acceptance = {
    pass: task.mode === "detailed_plan" ? Boolean(acceptance?.trim()) : true,
    detail:
      task.mode === "detailed_plan"
        ? acceptance?.trim()
          ? "Abschlusskriterien vorhanden"
          : "Architekturplan ohne Abschlusskriterien"
        : "für den Schnellplan nicht gefordert",
  };

  const risks = sectionMatching(plan, "risik") ?? "";
  results.risks = {
    pass: risks.trim().length >= 20,
    detail: risks.trim() ? "Risiken benannt" : "keine Risiken benannt",
  };

  const nonGoals = sectionMatching(plan, "nicht-ziele");
  results["non-goals"] = {
    pass: task.mode === "detailed_plan" ? Boolean(nonGoals?.trim()) : true,
    detail:
      task.mode === "detailed_plan"
        ? nonGoals?.trim()
          ? "Nicht-Ziele abgegrenzt"
          : "Architekturplan ohne Nicht-Ziele"
        : "für den Schnellplan nicht gefordert",
  };

  const phases = phaseCount(plan);
  const proportional = task.expectPhases
    ? phases >= 2
    : phases === 0 && (!task.expectMinimal || plan.length <= 2500);
  results.proportionality = {
    pass: proportional,
    detail: task.expectPhases
      ? `${phases} Phasen (mindestens 2 erwartet)`
      : phases === 0
        ? `keine Phasenbürokratie, ${plan.length} Zeichen`
        : `${phases} Phasen für eine Aufgabe, die keine braucht`,
  };

  const mechanical = MECHANICAL_CRITERIA.map((name) => results[name]);
  return {
    taskId: task.id,
    mode: task.mode,
    results,
    mechanicalPassed: mechanical.filter((entry) => entry.pass).length,
    mechanicalTotal: mechanical.length,
    /** Never scored here — a reviewer fills these in and they stay separate. */
    judgement: Object.fromEntries(
      JUDGEMENT_CRITERIA.map((name) => [name, "unbewertet"]),
    ),
  };
}

export function formatReport(scores) {
  const lines = ["# Plan-Eval — mechanische Bewertung", ""];
  let passed = 0;
  let total = 0;
  for (const score of scores) {
    passed += score.mechanicalPassed;
    total += score.mechanicalTotal;
    lines.push(
      `## ${score.taskId} (${score.mode}) — ${score.mechanicalPassed}/${score.mechanicalTotal}`,
    );
    for (const [name, result] of Object.entries(score.results)) {
      lines.push(`- ${result.pass ? "OK  " : "FAIL"} ${name}: ${result.detail}`);
    }
    lines.push("");
  }
  lines.push(`**Mechanisch gesamt: ${passed}/${total}**`, "");
  lines.push(
    "Nicht mechanisch bewertet und bewusst getrennt ausgewiesen: " +
      JUDGEMENT_CRITERIA.join(", ") +
      ".",
  );
  return lines.join("\n");
}
