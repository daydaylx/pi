import type { WorkflowMode } from "./workflow-status.ts";

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
  stateDiscarded: "workflow-capabilities:state-discarded",
  activated: "workflow-capabilities:activated",
} as const;

export interface WorkflowStateDiscardedEvent {
  cwd: string;
  sessionId: string;
}

/** Emitted only after a workflow activation was persisted successfully. */
export interface WorkflowActivatedEvent {
  cwd: string;
  sessionId: string;
  mode: WorkflowMode;
}

export type WorkflowCapabilityState =
  | "idle"
  | "planning"
  | "working"
  | "reviewing"
  | "paused"
  | "blocked"
  | "done";

export interface WorkflowCapabilitySnapshot {
  state: WorkflowCapabilityState;
  /** Current mode is provided for workflow-specific permission defaults. */
  mode?: WorkflowMode;
}
export interface WorkflowCapabilityRequest {
  respond(snapshot: WorkflowCapabilitySnapshot): void;
}

export interface WorkflowEventBus {
  emit(channel: string, value: unknown): void;
}

const DEFAULT_SNAPSHOT: WorkflowCapabilitySnapshot = { state: "idle", mode: "work" };

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
  if (
    mode !== undefined &&
    mode !== "work" &&
    mode !== "simple_plan" &&
    mode !== "detailed_plan"
  ) {
    return false;
  }
  switch ((value as { state?: unknown }).state) {
    case "idle":
    case "planning":
    case "working":
    case "reviewing":
    case "paused":
    case "blocked":
    case "done":
      return true;
    default:
      return false;
  }
}
