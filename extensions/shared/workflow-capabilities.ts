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

export type WorkflowCapabilityState =
  | "work"
  | "planning"
  | "reviewing"
  | "deciding"
  | "executing"
  | "paused"
  | "blocked"
  | "ready";

export interface WorkflowCapabilitySnapshot {
  state: WorkflowCapabilityState;
}
export interface WorkflowCapabilityRequest {
  respond(snapshot: WorkflowCapabilitySnapshot): void;
}

export interface WorkflowEventBus {
  emit(channel: string, value: unknown): void;
}

const DEFAULT_SNAPSHOT: WorkflowCapabilitySnapshot = { state: "work" };

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
  switch ((value as { state?: unknown }).state) {
    case "work":
    case "planning":
    case "reviewing":
    case "deciding":
    case "executing":
    case "paused":
    case "blocked":
    case "ready":
      return true;
    default:
      return false;
  }
}
