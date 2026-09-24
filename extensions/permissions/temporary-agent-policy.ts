/**
 * Guard for temporary task agents (`subagent` calls carrying `spec`).
 *
 * The runtime (pi-subagents) intersects requested capabilities with the
 * profile allowance. This parent-side guard is the second line: it refuses
 * everything that would widen a spec call beyond that contract, independent of
 * the installed package version. The main agent may only describe work and
 * request capabilities — never grant rights, pick the model directly, read
 * fork context or write files (ADR 031).
 */
import type { ToolCallEvent } from "@earendil-works/pi-coding-agent";
import {
  isPlanRestricted,
  isWorkflowStateUnknown,
  type WorkflowCapabilitySnapshot,
} from "../shared/workflow-capabilities.ts";
import type { PermissionLevel } from "../shared/workflow-status.ts";
import type { WorkflowAssessment } from "./workflow-policy.ts";

const PERMITTED: WorkflowAssessment = { blocked: false, reason: "" };

const KNOWN_PROFILES = ["analyse", "research", "verify", "implement"];
const PLAN_MODE_PROFILES = ["analyse", "research"];
const PLAN_MODE_CAPABILITIES = ["read", "search"];

/**
 * Parameters a spec call must not carry: the spec is the whole contract.
 * `model` would bypass the runtime's model choice, `cwd`/`output`/`skill`
 * would widen scope or write files, `context` may only be fresh.
 */
const FORBIDDEN_WITH_SPEC = [
  "agent",
  "task",
  "chain",
  "tasks",
  "config",
  "model",
  "cwd",
  "output",
  "skill",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True when the call is a temporary-agent (`spec`) delegation. */
export function isTemporarySpecCall(event: ToolCallEvent): boolean {
  return (
    event.toolName === "subagent" &&
    isRecord(event.input) &&
    event.input.spec !== undefined
  );
}

export function assessTemporaryAgentSpec(
  event: ToolCallEvent,
): WorkflowAssessment {
  if (!isTemporarySpecCall(event)) return PERMITTED;
  const input = event.input as Record<string, unknown>;
  const block = (reason: string): WorkflowAssessment => ({
    blocked: true,
    reason: `Temporärer Agent (ADR 031): ${reason}`,
  });

  if (typeof input.action === "string") {
    return block(
      "`spec` ist nur für Ausführungsaufrufe zulässig, nicht für Aktionen.",
    );
  }
  for (const key of FORBIDDEN_WITH_SPEC) {
    if (input[key] !== undefined) {
      return block(
        `\`spec\` darf nicht mit \`${key}\` kombiniert werden; der Vertrag steht vollständig im spec.`,
      );
    }
  }
  if (input.context !== undefined && input.context !== "fresh") {
    return block(
      "Temporäre Agenten sind stateless und starten nur mit `context: fresh`.",
    );
  }
  if (!isRecord(input.spec)) {
    return block("`spec` muss ein Objekt sein.");
  }
  const profile = input.spec.profile;
  if (typeof profile !== "string" || !KNOWN_PROFILES.includes(profile)) {
    return block(`Profil muss eines von ${KNOWN_PROFILES.join(", ")} sein.`);
  }
  if (profile === "verify") {
    // Dedup, Ticket und Commit-Gate des Verifiers hängen am Agentennamen
    // `verifier`. Bis sie an das Profil gebunden sind (Migrationsstufe 5),
    // würde ein spec-Aufruf sie umgehen.
    return block(
      "Profil `verify` ist noch nicht freigegeben. Prüfaufträge weiter über den Agenten `verifier` delegieren.",
    );
  }
  return PERMITTED;
}

/**
 * Plan Mode admits a spec call only when it is provably read-only and
 * artifact-free: profile analyse/research, no capability beyond read/search,
 * foreground, no output. The guard normalizes `artifacts` to false.
 */
export function planModeTemporarySpecAllowed(
  workflow: WorkflowCapabilitySnapshot,
  permissionLevel: PermissionLevel,
  event: ToolCallEvent,
): boolean {
  if (
    !isPlanRestricted(workflow) ||
    isWorkflowStateUnknown(workflow) ||
    permissionLevel === "readonly" ||
    !isTemporarySpecCall(event) ||
    assessTemporaryAgentSpec(event).blocked
  ) {
    return false;
  }
  const input = event.input as Record<string, unknown>;
  const spec = input.spec as Record<string, unknown>;
  if (!PLAN_MODE_PROFILES.includes(spec.profile as string)) return false;
  const requested = spec.requestedCapabilities;
  if (requested !== undefined) {
    if (
      !Array.isArray(requested) ||
      requested.some((c) => !PLAN_MODE_CAPABILITIES.includes(c as string))
    ) {
      return false;
    }
  }
  return (
    (input.async === undefined || input.async === false) &&
    (input.artifacts === undefined || input.artifacts === false)
  );
}
