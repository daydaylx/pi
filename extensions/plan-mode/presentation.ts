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

export function workflowUiState(mode: WorkflowMode): FrontendUiState["workflow"] {
  return { phase: mode, label: workflowModeLabel(mode) };
}

export function updateWorkflowPresentation(
  ctx: ExtensionContext,
  mode: WorkflowMode,
  pi?: ExtensionAPI,
): void {
  setTuiStatus(ctx, UI_STATUS_KEYS.workflow, workflowModeLabel(mode));
  if (auroraEpoch && pi) {
    publishFrontendUiPatch(pi, auroraEpoch, "plan-mode", {
      workflow: workflowUiState(mode),
    });
  }
}

export function clearWorkflowPresentation(ctx: ExtensionContext): void {
  setTuiStatus(ctx, UI_STATUS_KEYS.workflow, undefined);
}
