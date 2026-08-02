import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  type WorkflowMode,
  workflowModeLabel,
} from "../shared/workflow-mode.ts";
import { WORKFLOW_CAPABILITY_EVENTS } from "../shared/workflow-capabilities.ts";
import { updateWorkflowPresentation } from "./presentation.ts";

export type NotifyLevel = "info" | "warning" | "error";

export interface WorkflowSession {
  readonly pi: ExtensionAPI;
  selectedMode: WorkflowMode;
  notify(ctx: ExtensionContext, message: string, level?: NotifyLevel): void;
  setMode(ctx: ExtensionContext, mode: WorkflowMode): void;
  publishMode(ctx: ExtensionContext): void;
}

export function createWorkflowSession(pi: ExtensionAPI): WorkflowSession {
  const session: WorkflowSession = {
    pi,
    selectedMode: "work",
    notify(ctx, message, level = "info") {
      ctx.ui.notify(message, level);
    },
    setMode(ctx, mode) {
      session.selectedMode = mode;
      updateWorkflowPresentation(ctx, mode, pi);
      session.publishMode(ctx);
      session.notify(ctx, `${workflowModeLabel(mode)} aktiv.`);
    },
    publishMode(ctx) {
      pi.events.emit(WORKFLOW_CAPABILITY_EVENTS.activated, {
        cwd: ctx.cwd,
        sessionId: ctx.sessionManager.getSessionId(),
        mode: session.selectedMode,
      });
    },
  };
  return session;
}
