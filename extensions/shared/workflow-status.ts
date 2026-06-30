export const WORKFLOW_STATUS_EVENT = "pi-workflow:status";

export type WorkflowPhase =
  "idle" | "draft" | "reviewing" | "reviewed" | "executing" | "ready";

export type WorkflowStatusEvent =
  | {
      source: "plan";
      phase: WorkflowPhase;
      planningActive: boolean;
      planExists: boolean;
      completedTodos: number;
      totalTodos: number;
    }
  | {
      source: "git-guard";
      enabled: boolean;
    }
  | {
      source: "permission";
      yolo: boolean;
    };

export const WORKFLOW_MODE_LABEL: Record<WorkflowPhase, string> = {
  idle: "IDLE",
  draft: "PLAN",
  reviewing: "REVIEW",
  reviewed: "REVIEWED",
  executing: "WORK",
  ready: "READY",
};
