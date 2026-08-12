import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  type WorkflowMode,
  workflowModeLabel,
} from "../shared/workflow-mode.ts";
import { updateWorkflowPresentation } from "./presentation.ts";
import { readPlan, removePlan, writePlan } from "./plan-file.ts";

export type NotifyLevel = "info" | "warning" | "error";

export interface WorkflowSession {
  readonly pi: ExtensionAPI;
  selectedMode: WorkflowMode;
  notify(ctx: ExtensionContext, message: string, level?: NotifyLevel): void;
  setMode(ctx: ExtensionContext, mode: WorkflowMode): void;
  beginPlanningTurn(cwd: string): void;
  recordPlanWrite(success: boolean): void;
  recordPlanningAgentEnd(messages?: readonly unknown[]): void;
  finishPlanningTurn(cwd: string): void;
  consumePlanHandoff(): string | undefined;
  clearPlanHandoff(): void;
}

export function createWorkflowSession(pi: ExtensionAPI): WorkflowSession {
  let planningTurnActive = false;
  let planHandoff: string | undefined;
  let previousPlan: string | undefined;
  let planWriteSucceeded = false;
  let finalPlanningRunSucceeded = true;
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
    beginPlanningTurn(cwd) {
      planningTurnActive = true;
      planHandoff = undefined;
      previousPlan = readPlan(cwd);
      planWriteSucceeded = false;
      finalPlanningRunSucceeded = true;
    },
    recordPlanWrite(success) {
      if (planningTurnActive && success) planWriteSucceeded = true;
    },
    recordPlanningAgentEnd(messages = []) {
      if (!planningTurnActive) return;
      const last = [...messages].at(-1) as
        | { errorMessage?: unknown; stopReason?: unknown }
        | undefined;
      finalPlanningRunSucceeded =
        last?.errorMessage === undefined &&
        last?.stopReason !== "error" &&
        last?.stopReason !== "aborted";
    },
    finishPlanningTurn(cwd) {
      if (!planningTurnActive) return;
      planningTurnActive = false;
      const nextPlan = readPlan(cwd);
      if (finalPlanningRunSucceeded && planWriteSucceeded && nextPlan !== undefined) {
        planHandoff = nextPlan;
      } else if (previousPlan !== undefined) {
        writePlan(cwd, previousPlan);
      } else {
        removePlan(cwd);
      }
      previousPlan = undefined;
      planWriteSucceeded = false;
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
