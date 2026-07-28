/**
 * Routing level decision.
 *
 * Pure: combines the assessment (score + harte HIGH-Regeln) with an optional
 * manual override into a RoutingCoreDecision. Harte HIGH-Regeln always win
 * over the score; a manual upgrade is allowed; a manual downgrade of a hard
 * HIGH case is refused. The result is not yet frozen and carries no profile
 * identifiers — computeRouting adds profiles and freezes it.
 *
 * Thresholds (Auftrags-Abschnitt 7): 0–2 → low, 3–5 → standard, ≥6 → high.
 */
import type {
  RoutingAssessment,
  RoutingCoreDecision,
  RoutingInput,
  RoutingLevel,
} from "./types.ts";

const LEVEL_RANK: Record<RoutingLevel, number> = {
  low: 0,
  standard: 1,
  high: 2,
};

function levelFromScore(score: number): RoutingLevel {
  if (score <= 2) return "low";
  if (score <= 5) return "standard";
  return "high";
}

export function decideRouting(
  input: RoutingInput,
  assessment: RoutingAssessment,
): RoutingCoreDecision {
  const hardHigh = assessment.evidence.hardHighReasons.length > 0;
  // Harte HIGH-Regeln haben Vorrang vor der Punktzahl.
  const heuristicLevel = hardHigh ? "high" : levelFromScore(assessment.score);

  const manual = input.manualLevel;
  let level = heuristicLevel;
  let manuallyEscalated = false;
  let downgradeBlocked: string | undefined;

  if (manual && manual !== heuristicLevel) {
    if (LEVEL_RANK[manual] > LEVEL_RANK[heuristicLevel]) {
      // Manuelle Hochstufung ist immer erlaubt.
      level = manual;
      manuallyEscalated = true;
    } else if (hardHigh) {
      // Herabstufung eines hartes HIGH-Falls wird abgelehnt.
      level = "high";
      downgradeBlocked = `Manuelle Herabstufung blockiert: hartes HIGH-Risiko (${assessment.evidence.hardHighReasons.join(", ")}).`;
    } else {
      // Ohne harte Regel darf der Nutzer manuell herunterstufen.
      level = manual;
    }
  }

  const plannerRequired = level !== "low";
  // LOW darf den Reviewer nur überspringen, wenn Verifikation deklariert ist;
  // ohne ausführbare Checks bleibt eine minimale Review-Absicherung Pflicht.
  const reviewerRequired = level !== "low" || input.verification.length === 0;

  return {
    level,
    evidence: assessment.evidence,
    plannerRequired,
    reviewerRequired,
    manuallyEscalated,
    downgradeBlocked,
  };
}
