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
import { planningPrompt } from "./prompts.ts";
import { buildPlanContextMessage, PLAN_HANDOFF_RULES } from "./plan-context.ts";
import {
  clearWorkflowPresentation,
  setAuroraEpoch,
  updateWorkflowPresentation,
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
      workflow: workflowUiState(session.selectedMode, {
        pending: session.pendingMode(),
        planReady: session.readiness() ?? null,
      }),
    });
  });
  // The permission layer asks this on every tool call. Answering with the
  // *effective* mode is what makes the boundaries turn-stable: while a turn
  // runs, that is the mode it started under, not whatever has been selected
  // since.
  pi.events.on(WORKFLOW_CAPABILITY_EVENTS.request, (value) => {
    const request = value as Partial<WorkflowCapabilityRequest>;
    request.respond?.({ mode: session.effectiveMode() });
  });

  pi.on("before_agent_start", async (event, ctx) => {
    const mode = session.beginTurn(ctx);
    if (isPlanningMode(mode)) {
      return { systemPrompt: `${event.systemPrompt}\n\n${planningPrompt(mode)}` };
    }
    const approved = session.consumeApproval(ctx, event.prompt);
    if (!approved) return;
    const message = buildPlanContextMessage(approved.content, approved.hash);
    if (!message) return;
    // Two separate channels on purpose: only the fixed rules may be a system
    // instruction, while the plan itself travels as a custom message that Pi
    // hands to the provider with the user role, after the real user message.
    return {
      systemPrompt: `${event.systemPrompt}\n\n${PLAN_HANDOFF_RULES}`,
      message,
    };
  });

  // A low-level agent run may still be followed by an automatic retry or
  // compaction. Settle only once Pi confirms that no continuation remains,
  // otherwise a partial retry result could become the plan.
  pi.on("agent_settled", async (_event, ctx) => {
    session.settleTurn(ctx);
    const ready = session.readiness();
    updateWorkflowPresentation(
      ctx,
      session.selectedMode,
      pi,
      session.pendingMode(),
      ready ?? null,
    );
    if (!ready) return;
    session.notify(
      ctx,
      ready.qualityOk
        ? "Plan fertig. Shift+Tab oder /plan-decide: ausführen, weiter planen oder ohne Ausführung nach Work."
        : "Plan fertig, erfüllt aber die Mindestanforderungen seines Modus nicht. Shift+Tab oder /plan-decide entscheidet trotzdem.",
      ready.qualityOk ? "info" : "warning",
    );
  });
  pi.on("agent_end", async (event, _ctx) => {
    session.recordAgentEnd(event.messages);
  });

  pi.on("session_start", async (_event, ctx) => {
    session.resetForSession();
    session.setMode(ctx, "work");
  });
  pi.on("session_shutdown", async (_event, ctx) => {
    clearWorkflowPresentation(ctx);
  });
}
