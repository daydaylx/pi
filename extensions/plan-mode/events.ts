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
  // No confirmed emitter of CONTROL_CENTER_EVENTS.workflowThinkingDefault
  // exists anywhere in this repository. Manual thinking selection is the
  // only enforced behavior (extensions/permissions/thinking-control.ts);
  // switching workflow mode never changes the active thinking level (see
  // the regression test in tests/suites/ui.mjs). This listener is
  // speculative scaffolding for a possible closed-source-runtime consumer
  // (e.g. a "recommended" UI hint) that this repo can neither prove nor
  // disprove. Do not wire its response into thinking-control's
  // applySelection() — that would silently build the auto-thinking mode
  // this project has decided not to ship (docs/pi_agent_ux_konzept.md).
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
