import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  type WorkflowMode,
  workflowModeLabel,
} from "../shared/workflow-mode.ts";
import { updateWorkflowPresentation } from "./presentation.ts";
import { readPlan } from "./plan-file.ts";

export type NotifyLevel = "info" | "warning" | "error";

export interface WorkflowSession {
  readonly pi: ExtensionAPI;
  selectedMode: WorkflowMode;
  notify(ctx: ExtensionContext, message: string, level?: NotifyLevel): void;
  setMode(ctx: ExtensionContext, mode: WorkflowMode): void;
  beginPlanningTurn(): void;
  finishPlanningTurn(cwd: string): void;
  consumePlanHandoff(): string | undefined;
  clearPlanHandoff(): void;
}

export function createWorkflowSession(pi: ExtensionAPI): WorkflowSession {
  let planningTurnActive = false;
  let planHandoff: string | undefined;
  const session: WorkflowSession = {
    pi,
    selectedMode: "work",
    notify(ctx, message, level = "info") {
      ctx.ui.notify(message, level);
    },
    setMode(ctx, mode) {
      session.selectedMode = mode;
      updateWorkflowPresentation(ctx, mode, pi);
      session.notify(ctx, `${workflowModeLabel(mode)} aktiv.`);
    },
    beginPlanningTurn() {
      planningTurnActive = true;
      planHandoff = undefined;
    },
    finishPlanningTurn(cwd) {
      if (!planningTurnActive) return;
      planningTurnActive = false;
      planHandoff = readPlan(cwd);
    },
    consumePlanHandoff() {
      const handoff = planHandoff;
      planHandoff = undefined;
      return handoff;
    },
    clearPlanHandoff() {
      planHandoff = undefined;
    },
  };
  return session;
}
