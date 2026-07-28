/**
 * Routing presentation.
 *
 * The single place that maps a RoutingDecision to a compact, human-readable
 * string — symmetrical to presentation.ts being the single owner of the
 * WorkflowStatus→label mapping. Pure: no model names (only profile labels),
 * no internal reasoning, no side effects. Kept separate from the routing
 * logic (Auftrag: Fachlogik und Darstellung bleiben getrennt).
 */
import type { RoutingDecision, RoutingLevel } from "./types.ts";

const LEVEL_LABEL: Record<RoutingLevel, string> = {
  low: "LOW",
  standard: "STANDARD",
  high: "HIGH",
};

export function formatRoutingSummary(decision: RoutingDecision): string {
  const reasons = [
    ...decision.evidence.complexity,
    ...decision.evidence.risk,
    ...decision.evidence.uncertainty,
  ];
  const lines: string[] = [`Routing: ${LEVEL_LABEL[decision.level]}`];
  if (decision.evidence.hardHighReasons.length > 0) {
    lines.push(
      `- Hartes HIGH-Risiko: ${decision.evidence.hardHighReasons.join("; ")}`,
    );
  }
  lines.push(
    `- Gründe: ${reasons.length > 0 ? reasons.join("; ") : "keine zusätzlichen Signale"}`,
  );
  lines.push(
    `- Planung: ${decision.plannerRequired ? "erforderlich" : "optional"} · Review: ${decision.reviewerRequired ? "erforderlich" : "optional"}`,
  );
  const profiles = [`Worker=${decision.workerProfile}`];
  if (decision.plannerProfile) {
    profiles.unshift(`Planner=${decision.plannerProfile}`);
  }
  if (decision.reviewerProfile) {
    profiles.push(`Reviewer=${decision.reviewerProfile}`);
  }
  lines.push(`- Profile: ${profiles.join(" · ")}`);
  if (decision.manuallyEscalated) {
    lines.push("- manuell hochgestuft");
  }
  return lines.join("\n");
}
