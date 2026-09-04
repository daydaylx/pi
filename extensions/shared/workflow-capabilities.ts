import { WORKFLOW_MODES, type WorkflowMode } from "./workflow-mode.ts";

/**
 * Synchronous capability bridge between workflow and permission extensions.
 *
 * A workflow provider publishes its current snapshot by subscribing to
 * WORKFLOW_CAPABILITY_EVENTS.request and invoking respond during the event
 * dispatch.
 *
 * When nobody answers, the mode is `undefined` — deliberately not `work`.
 * Defaulting to `work` meant that a workflow provider which failed to load, was
 * disabled, or threw during registration silently downgraded the permission
 * layer to its most permissive workflow state: the guards would happily allow
 * project-wide writes because, as far as they could tell, no plan was running.
 * A missing answer is now treated as strictly as the strictest known state
 * (`isPlanRestricted` below), so the failure mode is a visible refusal instead
 * of an invisible loosening.
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

/** No provider answered. Every consumer must treat this as fail-closed. */
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
 * The single question the permission layer asks: must plan-mode restrictions
 * apply? An unknown state answers yes, so a broken or absent provider cannot
 * be the reason a write goes through.
 */
export function isPlanRestricted(
  snapshot: WorkflowCapabilitySnapshot,
): boolean {
  return (
    snapshot.mode === undefined ||
    snapshot.mode === "simple_plan" ||
    snapshot.mode === "detailed_plan"
  );
}
