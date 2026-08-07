import { WORKFLOW_MODES, type WorkflowMode } from "./workflow-mode.ts";

/**
 * Synchronous capability bridge between workflow and permission extensions.
 *
 * The permission extension deliberately defaults to `work` when no workflow
 * provider is installed. A workflow provider publishes its current snapshot
 * by subscribing to WORKFLOW_CAPABILITY_EVENTS.request and invoking respond
 * during the event dispatch.
 */

export const WORKFLOW_CAPABILITY_EVENTS = {
  request: "workflow-capabilities:request",
} as const;

export interface WorkflowCapabilitySnapshot {
  /** The selected mode is the only workflow truth. */
  mode: WorkflowMode;
}
export interface WorkflowCapabilityRequest {
  respond(snapshot: WorkflowCapabilitySnapshot): void;
}

export interface WorkflowEventBus {
  emit(channel: string, value: unknown): void;
}

const DEFAULT_SNAPSHOT: WorkflowCapabilitySnapshot = {
  mode: "work",
};

export function requestWorkflowCapabilities(
  events: WorkflowEventBus,
): WorkflowCapabilitySnapshot {
  let snapshot: WorkflowCapabilitySnapshot | undefined;
  events.emit(WORKFLOW_CAPABILITY_EVENTS.request, {
    respond(value: WorkflowCapabilitySnapshot) {
      if (!snapshot && isWorkflowCapabilitySnapshot(value)) snapshot = value;
    },
  } satisfies WorkflowCapabilityRequest);
  return snapshot ?? DEFAULT_SNAPSHOT;
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
