export type WorkflowMode = "work" | "simple_plan" | "detailed_plan";
export type TaskStatus = "active" | "needs_input" | "review" | "completed";
export type ActivityKind =
  | "idle"
  | "thinking"
  | "explore"
  | "file_change"
  | "verification"
  | "subagent"
  | "tool"
  | "responding"
  | "other";

export interface SessionSummary {
  id: string;
  name?: string;
  cwd: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface StateSnapshotV1 {
  session: { id?: string; name?: string; cwd?: string; connected: boolean };
  workflow: { mode: WorkflowMode; label: string; available: WorkflowMode[] };
  task: { title: string; phaseLabel: string; status: TaskStatus };
  activity: { kind: ActivityKind };
  permissions: {
    current?: string;
    label?: string;
    options: string[];
    pending?: { requestId: string; description: string };
  };
  lsp: { state?: string; detail?: string };
  model: { current?: string; available: string[] };
  thinking: { current?: string; available: string[] };
  changes: {
    filesCount: number;
    files: Array<{ path: string; additions?: number; deletions?: number }>;
  } | null;
  verification: {
    status?: string;
    requiredOutcomes: Record<string, string>;
    blockingRecommendedIds: string[];
  } | null;
  subagents: Array<{
    runId: string;
    agent: string;
    role: string;
    status: "running" | "paused" | "needs_attention" | "queued";
  }>;
  configuration: Record<string, string | number | boolean | null>;
}
