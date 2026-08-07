import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  AURORA_UI_CHANNELS,
  isAuroraUiStateRequest,
  publishAuroraUiSnapshot,
} from "../aurora-ui/state.ts";
import { CONTROL_CENTER_EVENTS } from "../shared/control-center-events.ts";
import {
  WORKFLOW_CAPABILITY_EVENTS,
  type WorkflowCapabilityRequest,
} from "../shared/workflow-capabilities.ts";
import { isPlanningMode } from "../shared/workflow-mode.ts";
import { planningPrompt, workPrompt } from "./prompts.ts";
import {
  clearWorkflowPresentation,
  setAuroraEpoch,
  workflowUiState,
} from "./presentation.ts";
import type { WorkflowSession } from "./session.ts";

export function registerPlanEvents(
  pi: ExtensionAPI,
  session: WorkflowSession,
): void {
  pi.events.on(AURORA_UI_CHANNELS.request, (value) => {
    if (!isAuroraUiStateRequest(value)) return;
    setAuroraEpoch(value.sessionEpoch);
    publishAuroraUiSnapshot(pi, value, "plan-mode", {
      workflow: workflowUiState(session.selectedMode),
    });
  });
  pi.events.on(WORKFLOW_CAPABILITY_EVENTS.request, (value) => {
    const request = value as Partial<WorkflowCapabilityRequest>;
    request.respond?.({ mode: session.selectedMode });
  });
  pi.events.on(CONTROL_CENTER_EVENTS.workflowThinkingDefault, (value) => {
    (
      value as {
        respond?: (result: { mode: string; defaultLevel: string }) => void;
      }
    ).respond?.({
      mode: session.selectedMode,
      defaultLevel:
        session.selectedMode === "detailed_plan" ? "high" : "medium",
    });
  });
  pi.on("before_agent_start", async () => {
    const content = isPlanningMode(session.selectedMode)
      ? planningPrompt(session.selectedMode)
      : workPrompt();
    return {
      message: { customType: "pi-workflow-mode", content } as AgentMessage,
    };
  });
  pi.on("session_start", async (_event, ctx) => {
    session.setMode(ctx, "work");
  });
  pi.on("session_shutdown", async (_event, ctx) => {
    clearWorkflowPresentation(ctx);
  });
}
