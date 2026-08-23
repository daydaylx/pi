import type { WorkflowMode } from "../shared/workflow-mode.ts";

export type TaskPhase = "understand" | "plan" | "work" | "verify" | "done";

export type ReceiptKind =
  | "investigation"
  | "search"
  | "edit"
  | "test"
  | "verification"
  | "subagent"
  | "generic";

export type ReceiptStatus = "running" | "completed" | "failed" | "warning";

export type FindingSeverity = "HIGH" | "MEDIUM" | "LOW" | "INFO";

export interface TaskFinding {
  severity?: FindingSeverity;
  message: string;
  evidence?: string;
}

export interface TaskReceipt {
  id: string;
  kind: ReceiptKind;
  status: ReceiptStatus;
  title: string;
  summary: string;
  metrics?: string[];
  findings?: TaskFinding[];
  evidenceRefs?: string[];
  errorDetails?: string;
  startedAt?: number;
  completedAt?: number;
  detailRef?: string;
}

export interface SubagentBranchInfo {
  agent: string;
  role?: string;
  runId?: string;
  status:
    | "running"
    | "paused"
    | "completed"
    | "failed"
    | "needs_attention"
    | "queued";
  focus?: string;
  progress?: string;
  findings?: TaskFinding[];
  evidence?: string[];
  error?: string;
  startedAt?: number;
}

export interface VerificationCriterion {
  label: string;
  status: "passed" | "failed" | "pending";
  detail?: string;
}

export interface VerificationCheck {
  id: string;
  label: string;
  status: "passed" | "failed" | "pending" | "unavailable";
  detail?: string;
}

export interface VerificationViewModel {
  verdict: "READY" | "NOT_READY" | "UNVERIFIED";
  criteria: VerificationCriterion[];
  checks?: VerificationCheck[];
  evidence?: string[];
  testsPassed?: number;
  testsTotal?: number;
  typecheck?: "passed" | "failed";
  lint?: "passed" | "failed";
  changedFilesCount?: number;
  unverifiedClaimsCount?: number;
  blockers: string[];
}

export interface CurrentWorkViewModel {
  category: string;
  title: string;
  target?: string;
  summary?: string;
  changingFiles?: string[];
  elapsedSeconds: number;
  tone?: "running" | "warning" | "error";
}

export interface TaskChangesSummary {
  filesCount: number;
  files: string[];
  linesAdded: number;
  linesRemoved: number;
}

export interface TaskViewModel {
  title: string;
  goal?: string;
  phase: TaskPhase;
  phaseLabel: string;
  workflowMode: WorkflowMode;
  currentWork?: CurrentWorkViewModel;
  findings: TaskFinding[];
  changesSummary?: TaskChangesSummary;
  receipts: TaskReceipt[];
  subagents: SubagentBranchInfo[];
  verification?: VerificationViewModel;
  contextPercent: number | null;
}
