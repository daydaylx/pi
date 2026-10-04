import { WORKFLOW_MODES, type WorkflowMode } from "./workflow-mode.ts";

/**
 * Synchronous capability bridge between workflow and permission extensions.
 *
 * A workflow provider publishes its current snapshot by subscribing to
 * WORKFLOW_CAPABILITY_EVENTS.request and invoking respond during the event
 * dispatch.
 *
 * When nobody answers, the mode remains `undefined` — it is not silently
 * rewritten to `work`. Permission consumers distinguish uncertainty by
 * operation: inspection remains available, while mutations are handled by
 * their active permission level. Only an affirmative plan-mode report enables
 * the plan-specific write ban.
 */

export const WORKFLOW_CAPABILITY_EVENTS = {
  request: "workflow-capabilities:request",
} as const;

export interface WorkflowCapabilitySnapshot {
  /**
   * The mode in force for the running turn, or `undefined` when no provider
   * answered. Never the *selected* mode while a turn is in flight — see
   * `WorkflowSession.effectiveMode`.
   */
  mode: WorkflowMode | undefined;
}

export interface WorkflowCapabilityRequest {
  respond(snapshot: WorkflowCapabilitySnapshot): void;
}

export interface WorkflowEventBus {
  emit(channel: string, value: unknown): void;
}

/** No provider answered; consumers apply operation-specific fallback policy. */
export const UNKNOWN_WORKFLOW: WorkflowCapabilitySnapshot = { mode: undefined };

export function requestWorkflowCapabilities(
  events: WorkflowEventBus,
): WorkflowCapabilitySnapshot {
  let snapshot: WorkflowCapabilitySnapshot | undefined;
  events.emit(WORKFLOW_CAPABILITY_EVENTS.request, {
    respond(value: WorkflowCapabilitySnapshot) {
      if (!snapshot && isWorkflowCapabilitySnapshot(value)) snapshot = value;
    },
  } satisfies WorkflowCapabilityRequest);
  return snapshot ?? UNKNOWN_WORKFLOW;
}

export function isWorkflowCapabilitySnapshot(
  value: unknown,
): value is WorkflowCapabilitySnapshot {
  if (!value || typeof value !== "object") return false;
  const mode = (value as { mode?: unknown }).mode;
  return (
    typeof mode === "string" && WORKFLOW_MODES.includes(mode as WorkflowMode)
  );
}

/** True when no provider answered at all. */
export function isWorkflowStateUnknown(
  snapshot: WorkflowCapabilitySnapshot,
): boolean {
  return snapshot.mode === undefined;
}

/**
 * Plan restrictions apply only when a provider affirmatively reports a plan
 * mode. Missing workflow state is not itself evidence that a turn is planning.
 */
export function isPlanRestricted(
  snapshot: WorkflowCapabilitySnapshot,
): boolean {
  return (
    snapshot.mode === "simple_plan" ||
    snapshot.mode === "detailed_plan"
  );
}
