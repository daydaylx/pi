import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  publishFrontendUiPatch,
  type FrontendUiState,
} from "../frontend-protocol/state-bus.ts";
import { setTuiStatus, UI_STATUS_KEYS } from "../shared/workflow-status.ts";
import {
  type WorkflowMode,
  workflowModeLabel,
} from "../shared/workflow-mode.ts";

let auroraEpoch: string | undefined;

export function setAuroraEpoch(epoch: string | undefined): void {
  auroraEpoch = epoch;
}

export function workflowUiState(
  mode: WorkflowMode,
  extras: Omit<FrontendUiState["workflow"], "phase" | "label"> = {},
): FrontendUiState["workflow"] {
  return { phase: mode, label: workflowModeLabel(mode), ...extras };
}

/**
 * `pending` is the mode the user selected while a turn was still running. It is
 * shown but not yet in force — the running turn keeps the mode it started under
 * (see `WorkflowSession.effectiveMode`), so the label has to say so rather than
 * claim a switch that has not happened.
 */
export function updateWorkflowPresentation(
  ctx: ExtensionContext,
  mode: WorkflowMode,
  pi?: ExtensionAPI,
  pending?: WorkflowMode,
  planReady?: FrontendUiState["workflow"]["planReady"],
): void {
  const label = pending
    ? `${workflowModeLabel(mode)} → ${workflowModeLabel(pending)} vorgemerkt`
    : workflowModeLabel(mode);
  setTuiStatus(ctx, UI_STATUS_KEYS.workflow, label);
  if (auroraEpoch && pi) {
    publishFrontendUiPatch(pi, auroraEpoch, "plan-mode", {
      workflow: workflowUiState(mode, { pending, planReady }),
    });
  }
}

export function clearWorkflowPresentation(ctx: ExtensionContext): void {
  setTuiStatus(ctx, UI_STATUS_KEYS.workflow, undefined);
}
