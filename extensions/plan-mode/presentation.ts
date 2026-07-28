import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  publishAuroraUiPatch,
  type AuroraUiState,
  type AuroraWorkflowPhase,
} from "../aurora-ui/state.ts";
import { setTuiStatus, UI_STATUS_KEYS } from "../shared/workflow-status.ts";
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

let currentAuroraEpoch: string | undefined;

export function setAuroraEpoch(epoch: string | undefined): void {
  currentAuroraEpoch = epoch;
}

export function computeAuroraWorkflowState(
  state?: WorkflowStateV3,
  override?: WorkflowStatus,
): AuroraUiState["workflow"] {
  const phase: AuroraWorkflowPhase = override ?? state?.status ?? "idle";
  const completed = state?.steps.filter(
    (step) => step.status === "completed",
  ).length;
  const total = state?.steps.length;
  const suffix =
    state &&
    state.steps.length > 0 &&
    (state.status === "working" ||
      state.status === "paused" ||
      state.status === "blocked")
      ? ` ${completed}/${state.steps.length}`
      : "";
  const label = `${LABELS[phase]}${suffix}`;
  return { phase, label, completed, total };
}

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
  pi?: ExtensionAPI,
): void {
  const info = computeAuroraWorkflowState(state, override);
  setTuiStatus(
    ctx,
    UI_STATUS_KEYS.workflow,
    override ? LABELS[override] : (!state ? LABELS.idle : info.label),
  );
  if (currentAuroraEpoch && pi) {
    publishAuroraUiPatch(pi, currentAuroraEpoch, "plan-mode", {
      workflow: info,
    });
  }
}

/** Remove the workflow label; the session no longer owns a workflow. */
export function clearWorkflowPresentation(
  ctx: ExtensionContext,
  pi?: ExtensionAPI,
): void {
  setTuiStatus(ctx, UI_STATUS_KEYS.workflow, undefined);
  if (currentAuroraEpoch && pi) {
    publishAuroraUiPatch(pi, currentAuroraEpoch, "plan-mode", {
      workflow: { phase: "idle", label: "ARBEIT" },
    });
  }
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

type MutableUi = ExtensionContext["ui"] & {
  input?: (title: string, placeholder?: string) => Promise<string | undefined>;
};

/**
 * Ask for a single line of text in the TUI.
 *
 * Hosts without a text input simply have no `input` method, and every caller
 * has to treat "no answer" and "empty answer" the same way — so this resolves
 * to undefined instead of throwing or inventing a fallback prompt.
 */
export async function promptInput(
  ctx: ExtensionContext,
  title: string,
  placeholder?: string,
): Promise<string | undefined> {
  return await (ctx.ui as MutableUi).input?.(title, placeholder);
}
