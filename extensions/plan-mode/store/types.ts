/** Shared workflow types, size limits and validation patterns. */
import type { PlanSnapshot } from "../plan-snapshot.ts";
import type { RoutingReportMetrics } from "../routing/types.ts";
// Re-export only: the canonical declaration lives in shared/workflow-status.ts
// so permissions and the UI can read it without importing plan-mode.
export type { WorkflowStatus } from "../../shared/workflow-status.ts";
import type { WorkflowStatus } from "../../shared/workflow-status.ts";

export const WORKFLOW_STATE_VERSION = 3 as const;
export const MAX_PLAN_BYTES = 256 * 1024;
export const MAX_STATE_BYTES = 512 * 1024;
export const MAX_DIRECT_TASK_BYTES = 128 * 1024;
export const HASH_PATTERN = /^[0-9a-f]{64}$/i;
export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type WorkflowStepStatus =
  "pending" | "in_progress" | "completed" | "blocked";

export interface WorkflowStepState {
  id: string;
  status: WorkflowStepStatus;
  evidence?: string;
}

export interface WorkflowCompletionState {
  outcome: "passed" | "override";
  diffHash: string;
  reviewerVerdict: "PASS" | "REWORK" | "UNVERIFIABLE";
  overrideReason?: string;
  completedAt: string;
}

export interface WorkflowStateV3 {
  version: typeof WORKFLOW_STATE_VERSION;
  revision: number;
  planId: string;
  planRevision: number;
  planHash: string;
  status: WorkflowStatus;
  activeStepId?: string;
  steps: WorkflowStepState[];
  reviewedPlanHash?: string;
  completion?: WorkflowCompletionState;
  updatedAt: string;
}

export interface WorkflowStateLoadResult {
  planContent?: string;
  snapshot?: PlanSnapshot;
  state?: WorkflowStateV3;
  stateToken: string;
  recovered: boolean;
  migrationRequired: boolean;
  warnings: string[];
}

export interface DirectTask {
  version: 1;
  taskId: string;
  goal: string;
  technicalScope: string[];
  verification: string[];
  acceptanceCriteria: string[];
  updatedAt: string;
}

export interface CompletionReport {
  version: 1;
  completionId: string;
  planId?: string;
  planRevision?: number;
  planHash?: string;
  directTaskId?: string;
  diffHash: string;
  outcome: "passed" | "override";
  reviewerVerdict: "PASS" | "REWORK" | "UNVERIFIABLE";
  checks: Array<{
    name: string;
    classification: "required" | "recommended" | "advisory";
    status: "pass" | "fail" | "not_run";
    summary: string;
  }>;
  scopeFindings: string[];
  residualRisks: string[];
  reviewerSummary: string;
  overrideReason?: string;
  /** Neutral routing metrics captured for the run, if routing ran. */
  routing?: RoutingReportMetrics;
  completedAt: string;
}

export interface WorkflowLockHandle {
  path: string;
  release(): void;
}

export const REQUIRED_PASS_CHECKS = new Set([
  "plan-steps",
  "git-diff-check",
  "hard-boundaries",
  "technical-scope",
  "declared-verification",
  "independent-reviewer",
  "diff-stability",
]);

export interface LegacyState {
  version?: number;
  revision?: number;
  planId?: string;
  planHash?: string;
  planType?: string;
  lifecycle?: string;
  phase?: string;
  reviewedHash?: string;
  progress?: Array<Record<string, unknown>>;
  execution?: {
    ownerId?: string;
    leaseExpiresAt?: string;
  };
}
