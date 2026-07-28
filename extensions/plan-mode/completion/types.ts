/**
 * Shared completion types.
 *
 * Deliberately free of file system access, execution, formatting and state
 * mutation so every completion module — and the type-only importers outside
 * plan-mode — can depend on this without pulling in the pipeline.
 */
import type { ExecFn } from "../../setup-core/verify-profiles.ts";
import type { PlanSnapshot } from "../plan-snapshot.ts";
import type {
  CompletionReport,
  DirectTask,
  WorkflowStateV3,
} from "../store/index.ts";

export type CompletionClassification = "required" | "recommended" | "advisory";
export type CompletionCheckStatus = "pass" | "fail" | "not_run";
export type CompletionReviewerVerdict = "PASS" | "REWORK" | "UNVERIFIABLE";

export interface CompletionCheck {
  name: string;
  classification: CompletionClassification;
  status: CompletionCheckStatus;
  summary: string;
  durationMs?: number;
  output?: string;
}

export interface ChangedFile {
  path: string;
  status: string;
  untracked: boolean;
}

export interface DiffEvidence {
  changedFiles: ChangedFile[];
  diffStat: string;
  reviewDiff: string;
  diffHash: string;
  diffCheck: CompletionCheck;
  warnings: string[];
}

export interface CompletionReviewerInput {
  plan?: PlanSnapshot;
  directTask?: DirectTask;
  changedFiles: ChangedFile[];
  diff: string;
  diffHash: string;
  checks: CompletionCheck[];
  scopeFindings: string[];
}

export interface CompletionReviewerResult {
  verdict: CompletionReviewerVerdict;
  summary: string;
  raw?: string;
}

export interface CompletionLspResult {
  path: string;
  status: "pass" | "fail" | "unavailable";
  summary: string;
}

/**
 * What the verification checks actually need. Kept separate from the full
 * pipeline context so the read-only diagnosis (`/verify-gate`) can call the
 * very same functions without inventing a reviewer or an LSP bridge.
 */
export interface CompletionVerificationContext {
  projectRoot: string;
  trusted: boolean;
  exec: ExecFn;
  plan?: PlanSnapshot;
  directTask?: DirectTask;
}

export interface CompletionPipelineContext extends CompletionVerificationContext {
  state?: WorkflowStateV3;
  runReviewer(
    input: CompletionReviewerInput,
  ): Promise<CompletionReviewerResult>;
  runLsp(files: string[]): Promise<CompletionLspResult[]>;
}

export interface CompletionPipelineResult {
  status: "pass" | "fail" | "blocked";
  checks: CompletionCheck[];
  changedFiles: ChangedFile[];
  diffHash: string;
  scopeFindings: string[];
  residualRisks: string[];
  reviewer: CompletionReviewerResult;
  report?: CompletionReport;
}

/** Raw shape returned by the injected exec function. */
export interface RawExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
  killed: boolean;
}
