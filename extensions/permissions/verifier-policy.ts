/**
 * Technical enforcement for verifier delegations.
 *
 * Fresh-Context-Verifier sehen nur das `task`-Feld. Damit ein Verifier-Lauf
 * überhaupt ein unabhängiges Urteil bilden kann, verlangt diese Policy die
 * vollständige Übergabe vor dem Start — statt auf Appelle in Prompt oder
 * Doku zu vertrauen. Sie hängt bewusst nicht am Subagenten-Paket, dessen
 * akzeptierte Parameter sich mit der installierten Version ändern können;
 * die Guard-Schicht fängt jeden `subagent`-Aufruf unabhängig davon ab.
 */
import type { ToolCallEvent } from "@earendil-works/pi-coding-agent";
import type { WorkflowAssessment } from "./workflow-policy.ts";

const PERMITTED: WorkflowAssessment = { blocked: false, reason: "" };

const VERIFIER_AGENT = "verifier";

/** Pflichtabschnitte der Delegationsvorlage aus docs/subagents.md. */
export const VERIFIER_REQUIRED_SECTIONS = [
  { marker: "Original User Request:", label: "Ziel (Original User Request)" },
  {
    marker: "Delegated Question:",
    label: "konkrete Teilfrage/Scope (Delegated Question)",
  },
  {
    marker: "Implementation / Diff to verify:",
    label: "Diff (Implementation / Diff to verify)",
  },
  {
    marker: "Pre-existing workspace state",
    label: "Baseline (Pre-existing workspace state)",
  },
] as const;

const ACCEPTANCE_PATTERN = /acceptance|akzeptanz/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Prüft einen einzelnen `subagent`-Tool-Call. Management-Aktionen und alle
 * anderen Rollen laufen unverändert durch.
 */
export function assessVerifierDelegation(
  event: ToolCallEvent,
): WorkflowAssessment {
  if (event.toolName !== "subagent") return PERMITTED;
  const input = isRecord(event.input) ? event.input : {};
  if (typeof input.action === "string") return PERMITTED;
  if (input.agent !== VERIFIER_AGENT) return PERMITTED;

  const errors: string[] = [];
  if (input.turnBudget !== undefined) {
    errors.push(
      "turnBudget ist für Verifier-Delegationen verboten; maßgeblich ist ausschließlich das Profil-Timeout aus agents/verifier.md.",
    );
  }
  const task = typeof input.task === "string" ? input.task : "";
  if (!task.trim()) {
    return {
      blocked: true,
      reason:
        "Verifier-Delegation abgelehnt: kein Prüfauftrag (task) übergeben. Vorlage: docs/subagents.md.",
    };
  }
  const missing: string[] = VERIFIER_REQUIRED_SECTIONS.filter(
    (section) => !task.includes(section.marker),
  ).map((section) => section.label);
  if (!ACCEPTANCE_PATTERN.test(task)) {
    missing.push("Akzeptanzkriterien (Acceptance)");
  }
  if (missing.length > 0) {
    return {
      blocked: true,
      reason: `Verifier-Delegation abgelehnt: unvollständiger Prüfauftrag. Es fehlt: ${missing.join(
        "; ",
      )}. Pflicht ist die vollständige Vorlage aus docs/subagents.md (Ziel, Scope, Diff, Baseline, Akzeptanzkriterien).`,
    };
  }
  if (errors.length > 0) {
    return { blocked: true, reason: errors.join(" ") };
  }
  return PERMITTED;
}
