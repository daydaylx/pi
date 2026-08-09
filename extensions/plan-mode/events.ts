import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  AURORA_UI_CHANNELS,
  isAuroraUiStateRequest,
  publishAuroraUiSnapshot,
} from "../aurora-ui/state.ts";
import {
  WORKFLOW_CAPABILITY_EVENTS,
  type WorkflowCapabilityRequest,
} from "../shared/workflow-capabilities.ts";
import { isPlanningMode } from "../shared/workflow-mode.ts";
import { planningPrompt, workPrompt } from "./prompts.ts";
import { removePlan } from "./plan-file.ts";
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
  pi.on("before_agent_start", async (_event, ctx) => {
    const mode = session.selectedMode;
    if (isPlanningMode(mode)) {
      // Mode selection preserves an existing plan. A real planning turn is the
      // first point at which that plan may be replaced.
      removePlan(ctx.cwd);
      session.beginPlanningTurn();
      return {
        message: {
          customType: "pi-workflow-mode",
          content: planningPrompt(mode),
        } as AgentMessage,
      };
    }
    return {
      message: {
        customType: "pi-workflow-mode",
        content: workPrompt(session.consumePlanHandoff()),
      } as AgentMessage,
    };
  });
  pi.on("agent_end", async (_event, ctx) => {
    session.finishPlanningTurn(ctx.cwd);
  });
  pi.on("session_start", async (_event, ctx) => {
    session.clearPlanHandoff();
    session.setMode(ctx, "work");
  });
  pi.on("session_shutdown", async (_event, ctx) => {
    clearWorkflowPresentation(ctx);
  });
}
