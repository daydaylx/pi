import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { setTuiStatus, ZENTUI_STATUS_KEYS } from "../shared/workflow-status.ts";
import type { PlanSnapshot } from "./plan-snapshot.ts";
import type { WorkflowStateV3, WorkflowStatus } from "./store/index.ts";

const LABELS: Record<WorkflowStatus, string> = {
  idle: "ARBEIT",
  planning: "PLANUNG",
  working: "ARBEIT",
  reviewing: "REVIEW",
  paused: "PAUSIERT",
  blocked: "BLOCKIERT",
  done: "FERTIG",
};

/**
 * Publish the workflow label.
 *
 * `override` covers the phases that have no persisted state yet — planning and
 * review run before the first sidecar write, and without it the status bar
 * would keep claiming "ARBEIT" while the planner is working.
 */
export function updateWorkflowPresentation(
  ctx: ExtensionContext,
  state?: WorkflowStateV3,
  override?: WorkflowStatus,
): void {
  if (override) {
    setTuiStatus(ctx, ZENTUI_STATUS_KEYS.workflow, LABELS[override]);
    return;
  }
  if (!state) {
    setTuiStatus(ctx, ZENTUI_STATUS_KEYS.workflow, LABELS.idle);
    return;
  }
  const completed = state.steps.filter(
    (step) => step.status === "completed",
  ).length;
  const suffix =
    state.steps.length > 0 &&
    (state.status === "working" ||
      state.status === "paused" ||
      state.status === "blocked")
      ? ` ${completed}/${state.steps.length}`
      : "";
  setTuiStatus(
    ctx,
    ZENTUI_STATUS_KEYS.workflow,
    `${LABELS[state.status]}${suffix}`,
  );
}

/** Remove the workflow label; the session no longer owns a workflow. */
export function clearWorkflowPresentation(ctx: ExtensionContext): void {
  setTuiStatus(ctx, ZENTUI_STATUS_KEYS.workflow, undefined);
}

export function formatPlanSteps(
  snapshot: PlanSnapshot,
  state: WorkflowStateV3,
): string {
  const statuses = new Map(state.steps.map((step) => [step.id, step.status]));
  return snapshot.steps
    .map(
      (step, index) =>
        `${index + 1}. [${statuses.get(step.id) ?? "pending"}] ${step.text}`,
    )
    .join("\n");
}

export function workflowWarning(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
