/**
 * Pure need/risk decision for the optional LLM verifier: should it run at
 * all for the given diff? This module never talks to a model and never sees
 * dedup, tickets or workspace state — assessVerifierDelegation composes it
 * with those in a later integration step.
 *
 * Deliberately excluded as a signal: diff size or file count. A large
 * mechanical rename touches many files without adding semantic risk, and a
 * one-line permission change is high-risk regardless of size — only path
 * identity (the existing verifier-required-paths.ts catalog) and an explicit
 * trigger with evidence are trusted here.
 */
import {
  matchingVerifierRequiredPaths,
  type VerifierRequiredPathHit,
} from "./verifier-required-paths.ts";

export type VerifierNeed = "required" | "justified" | "not_needed";

/**
 * The Phase 2 spec/guard layer is the only place allowed to construct one of
 * these from untrusted input and is responsible for rejecting any value
 * outside this union (fail-closed). This module trusts the trigger's
 * identity but still requires non-empty evidence before treating it as
 * justification.
 */
export type VerifierOptionalTrigger =
  | "user_requested"
  | "semantic_contract_risk"
  | "uncovered_behavior"
  | "failed_check_after_fix"
  | "cross_boundary_change"
  | "environment_uncertainty";

export interface VerifierOptionalTriggerClaim {
  trigger: VerifierOptionalTrigger;
  evidence: string;
}

/** Runtime-checkable mirror of VerifierOptionalTrigger for validating untyped input. */
export const VERIFIER_OPTIONAL_TRIGGERS: readonly VerifierOptionalTrigger[] = [
  "user_requested",
  "semantic_contract_risk",
  "uncovered_behavior",
  "failed_check_after_fix",
  "cross_boundary_change",
  "environment_uncertainty",
];

export function isVerifierOptionalTrigger(
  value: unknown,
): value is VerifierOptionalTrigger {
  return (
    typeof value === "string" &&
    (VERIFIER_OPTIONAL_TRIGGERS as readonly string[]).includes(value)
  );
}

/**
 * The optional-trigger claim is rendered into the same markdown-section
 * style the rest of the verifier task template uses (docs/subagents.md), so
 * a legacy `agent: "verifier"` caller can supply the identical marker in
 * free text and reach the same Need-Gate as a `spec.profile: "verify"` call
 * (Arbeitsvertrag §8: kein Pfad darf die Policy umgehen).
 */
const OPTIONAL_TRIGGER_HEADING_PATTERN =
  /^(?:#{1,6}\s*)?optional verifier trigger\s*:?\s*$/im;
const TRIGGER_LINE_PATTERN = /^trigger\s*:\s*(\S+)\s*$/im;
const EVIDENCE_LINE_PATTERN = /^evidence\s*:\s*(.+)$/im;

export function renderOptionalTriggerSection(
  claim: VerifierOptionalTriggerClaim,
): string {
  return `## Optional verifier trigger\ntrigger: ${claim.trigger}\nevidence: ${claim.evidence.trim()}`;
}

/**
 * Extracts an optional trigger claim from free-text verifier task input, if
 * present and structurally valid. A missing or malformed claim is never an
 * error here — it just means assessVerifierNeed sees no trigger and falls
 * through to not_needed, which is the same fail-closed outcome an explicit
 * rejection would produce.
 */
export function extractOptionalTriggerClaim(
  task: string,
): VerifierOptionalTriggerClaim | undefined {
  if (!OPTIONAL_TRIGGER_HEADING_PATTERN.test(task)) return undefined;
  const trigger = TRIGGER_LINE_PATTERN.exec(task)?.[1];
  const evidence = EVIDENCE_LINE_PATTERN.exec(task)?.[1]?.trim();
  if (!isVerifierOptionalTrigger(trigger) || !evidence) return undefined;
  return { trigger, evidence };
}

export interface VerifierRiskInput {
  /** Workspace-relative paths touched by the current diff. */
  changedFiles: readonly string[];
  /**
   * True only when the current user's own request explicitly asks for an
   * independent verifier run. The caller — not this module — is responsible
   * for never deriving this from the main agent's own judgment; see the
   * Sicherheitsregel in assessVerifierDelegation.
   */
  userRequestedVerification: boolean;
  /** An optional structured trigger, already validated by the Phase 2 guard. */
  optionalTrigger?: VerifierOptionalTriggerClaim;
}

export interface VerifierNeedAssessment {
  need: VerifierNeed;
  reasonCode: string;
  reason: string;
  requiredPathHits: VerifierRequiredPathHit[];
}

/**
 * Determines whether the optional LLM verifier is required, justified or
 * unnecessary for the given diff. Only a hard-path hit or an explicit user
 * request can produce "required" — a trigger, however strong, never does.
 */
export function assessVerifierNeed(
  input: VerifierRiskInput,
): VerifierNeedAssessment {
  if (input.userRequestedVerification) {
    return {
      need: "required",
      reasonCode: "user_requested",
      reason:
        "Verifier ist Pflicht: der Nutzer hat eine unabhängige Prüfung ausdrücklich angefordert.",
      requiredPathHits: [],
    };
  }

  const requiredPathHits = matchingVerifierRequiredPaths(input.changedFiles);
  if (requiredPathHits.length > 0) {
    const paths = [...new Set(requiredPathHits.map((hit) => hit.path))].join(
      ", ",
    );
    const categories = [
      ...new Set(requiredPathHits.map((hit) => hit.category)),
    ].join("; ");
    return {
      need: "required",
      reasonCode: "hard_path",
      reason: `Verifier ist Pflicht: der Diff berührt ${paths} (${categories}).`,
      requiredPathHits,
    };
  }

  const trigger = input.optionalTrigger;
  if (trigger && trigger.evidence.trim().length > 0) {
    return {
      need: "justified",
      reasonCode: trigger.trigger,
      reason: `Verifier ist optional zulässig: Trigger "${trigger.trigger}" mit Evidenz "${trigger.evidence.trim()}".`,
      requiredPathHits: [],
    };
  }

  return {
    need: "not_needed",
    reasonCode: trigger ? "trigger_without_evidence" : "no_trigger",
    reason: trigger
      ? `Verifier ist nicht nötig: Trigger "${trigger.trigger}" ohne belastbare Evidenz reicht nicht aus.`
      : "Verifier ist nicht nötig: kein Hard-Pfad, keine Nutzeranforderung, kein gültiger optionaler Trigger.",
    requiredPathHits: [],
  };
}
