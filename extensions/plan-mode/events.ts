import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  FRONTEND_UI_CHANNELS,
  isFrontendUiStateRequest,
  publishFrontendUiSnapshot,
} from "../frontend-protocol/state-bus.ts";
import {
  WORKFLOW_CAPABILITY_EVENTS,
  type WorkflowCapabilityRequest,
} from "../shared/workflow-capabilities.ts";
import { isPlanningMode } from "../shared/workflow-mode.ts";
import { planningPrompt, workPrompt } from "./prompts.ts";
import { isPlanFilePath } from "./plan-file.ts";
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
  pi.events.on(FRONTEND_UI_CHANNELS.request, (value) => {
    if (!isFrontendUiStateRequest(value)) return;
    setAuroraEpoch(value.sessionEpoch);
    publishFrontendUiSnapshot(pi, value, "plan-mode", {
      workflow: workflowUiState(session.selectedMode),
    });
  });
  pi.events.on(WORKFLOW_CAPABILITY_EVENTS.request, (value) => {
    const request = value as Partial<WorkflowCapabilityRequest>;
    request.respond?.({ mode: session.selectedMode });
  });
  pi.on("before_agent_start", async (event, ctx) => {
    const mode = session.selectedMode;
    const instruction = isPlanningMode(mode)
      ? planningPrompt(mode)
      : workPrompt(session.consumePlanHandoff());
    if (isPlanningMode(mode)) session.beginPlanningTurn(ctx.cwd);
    // An ordinary work turn carries no instruction at all, so it must not
    // touch the system prompt.
    if (!instruction) return;
    // `systemPrompt` is applied only to this provider request by Pi's runtime.
    // Returning a custom message here would persist the same mode text on every
    // turn and make it part of all later provider contexts.
    return {
      systemPrompt: `${event.systemPrompt}\n\n${instruction}`,
    };
  });
  // A low-level agent run may still be followed by an automatic retry or
  // compaction. Capture the plan only once Pi confirms that no continuation
  // remains, otherwise a partial retry result could become the handoff.
  pi.on("agent_settled", async (_event, ctx) => {
    session.finishPlanningTurn(ctx.cwd);
  });
  pi.on("agent_end", async (event, _ctx) => {
    session.recordPlanningAgentEnd(event.messages);
  });
  pi.on("tool_result", async (event, ctx) => {
    if (event.toolName !== "write" && event.toolName !== "edit") return;
    const args = event.input as { path?: unknown };
    if (isPlanFilePath(args.path, ctx.cwd))
      session.recordPlanWrite(!event.isError);
  });
  pi.on("session_start", async (_event, ctx) => {
    session.clearPlanHandoff();
    session.setMode(ctx, "work");
  });
  pi.on("session_shutdown", async (_event, ctx) => {
    clearWorkflowPresentation(ctx);
  });
}
