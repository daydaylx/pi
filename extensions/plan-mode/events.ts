/**
 * Lifecycle and capability event wiring.
 *
 * Callbacks stay thin on purpose: they resolve what happened and delegate to a
 * controller. The two capability responders exist so permissions and thinking
 * can read the workflow state without importing plan-mode.
 */
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { CONTROL_CENTER_EVENTS } from "../shared/control-center-events.ts";
import {
  WORKFLOW_CAPABILITY_EVENTS,
  type WorkflowCapabilityRequest,
} from "../shared/workflow-capabilities.ts";
import { finishWorkflow } from "./completion-commands.ts";
import { executionPrompt, pauseExecution } from "./execution.ts";
import { finalizePlanning, planningPrompt, reviewPrompt } from "./planning.ts";
import { clearWorkflowPresentation, workflowWarning } from "./presentation.ts";
import type { WorkflowSession } from "./session.ts";
import { loadDirectTask } from "./store/index.ts";

export function registerPlanEvents(
  pi: ExtensionAPI,
  session: WorkflowSession,
): void {
  pi.events.on(WORKFLOW_CAPABILITY_EVENTS.request, (value) => {
    const request = value as Partial<WorkflowCapabilityRequest>;
    if (typeof request.respond !== "function") return;
    request.respond({
      state: session.planningKind
        ? session.planningIsReview
          ? "reviewing"
          : "planning"
        : (session.current.state?.status ?? "idle"),
      mode: session.workflowMode(),
    });
  });

  pi.events.on(CONTROL_CENTER_EVENTS.workflowThinkingDefault, (value) => {
    const event = value as {
      respond?: (result: { mode: string; defaultLevel: string }) => void;
    };
    event.respond?.({
      mode:
        session.planningKind ??
        (session.current.state?.status === "working" ? "work" : "idle"),
      defaultLevel:
        session.planningKind === "detailed_plan" ? "high" : "medium",
    });
  });

  pi.on("before_agent_start", async (_event, ctx) => {
    if (session.planningKind)
      return {
        message: {
          customType: "pi-plan-context",
          content:
            session.planningIsReview && session.current.planContent
              ? reviewPrompt(session.current.planContent)
              : planningPrompt(session.planningKind),
        } as AgentMessage,
      };
    const loaded = session.reload(ctx);
    if (loaded.snapshot && loaded.state?.status === "working") {
      return {
        message: {
          customType: "pi-work-context",
          content: executionPrompt(loaded.snapshot, loaded.state),
        } as AgentMessage,
      };
    }
    const directTask = loadDirectTask(ctx.cwd);
    if (directTask) {
      return {
        message: {
          customType: "pi-direct-task-context",
          content: `Aktive direkte Aufgabe:\n${JSON.stringify(directTask, null, 2)}`,
        } as AgentMessage,
      };
    }
    return undefined;
  });

  pi.on("agent_settled", async (_event, ctx) => {
    if (session.planningKind) {
      await finalizePlanning(session, ctx);
      return;
    }
    const loaded = session.reload(ctx);
    if (
      loaded.state?.status === "reviewing" &&
      loaded.state.steps.length > 0 &&
      loaded.state.steps.every((step) => step.status === "completed")
    ) {
      await finishWorkflow(session, ctx, false);
    }
  });

  pi.on("session_start", async (_event, ctx) => {
    session.activeCwd = ctx.cwd;
    session.activeContext = ctx;
    session.planningKind =
      pi.getFlag("plan") === true ? "detailed_plan" : undefined;
    session.planningBaseContent = undefined;
    session.planningIsReview = false;
    try {
      const loaded = session.reload(ctx);
      for (const warning of loaded.warnings)
        session.notify(ctx, warning, "warning");
      if (loaded.migrationRequired) {
        session.notify(
          ctx,
          "Legacy-Workflow erkannt. Schließe alte Sessions und nutze /migrate-plan.",
          "warning",
        );
      } else if (loaded.state?.status === "working") {
        session.notify(
          ctx,
          "Unterbrochene Ausführung erkannt. Es gibt keine zeitgesteuerte Übernahme; nutze /work für explizite Recovery.",
          "warning",
        );
      }
    } catch (error) {
      session.notify(
        ctx,
        `Workflow-State nicht sicher geladen: ${workflowWarning(error)}`,
        "error",
      );
    }
  });

  pi.on("session_shutdown", async (_event, ctx: ExtensionContext) => {
    if (
      session.activeCwd === ctx.cwd &&
      ctx.isProjectTrusted() &&
      session.current.state?.status === "working"
    ) {
      try {
        session.replaceState(ctx, pauseExecution(session.current.state));
      } catch (error) {
        session.notify(
          ctx,
          `Pause-State nicht gespeichert: ${workflowWarning(error)}`,
          "warning",
        );
      }
    }
    session.activeCwd = undefined;
    session.activeContext = undefined;
    session.planningKind = undefined;
    clearWorkflowPresentation(ctx);
  });
}
