/**
 * The persisted completion report.
 *
 * This is a persistence schema bound to store/types.ts, not user-facing text:
 * it is what commitWorkflowDone validates and what the archive keeps. An
 * override is recorded as an explicit outcome with its justification, never as
 * a silent pass.
 */
import { randomUUID } from "node:crypto";
import type { PlanSnapshot } from "../plan-snapshot.ts";
import type { CompletionReport } from "../store/index.ts";
import { canOverrideCompletion } from "./result-policy.ts";
import type {
  CompletionCheck,
  CompletionPipelineContext,
  CompletionPipelineResult,
  CompletionReviewerResult,
  DiffEvidence,
} from "./types.ts";

function reportChecks(checks: readonly CompletionCheck[]) {
  return checks.map((check) => ({
    name: check.name,
    classification: check.classification,
    status: check.status,
    summary: check.summary,
  }));
}

export function buildReport(
  ctx: CompletionPipelineContext,
  evidence: DiffEvidence,
  checks: CompletionCheck[],
  scopeFindings: string[],
  residualRisks: string[],
  reviewer: CompletionReviewerResult,
  overrideReason?: string,
): CompletionReport {
  const now = new Date().toISOString();
  return {
    version: 1,
    completionId: randomUUID(),
    ...(ctx.plan
      ? {
          planId: ctx.plan.planId,
          planRevision: ctx.plan.planRevision,
          planHash: ctx.plan.planHash,
        }
      : {}),
    ...(ctx.directTask ? { directTaskId: ctx.directTask.taskId } : {}),
    diffHash: evidence.diffHash,
    outcome: overrideReason ? "override" : "passed",
    reviewerVerdict: reviewer.verdict,
    checks: reportChecks(checks),
    scopeFindings,
    residualRisks,
    reviewerSummary: reviewer.summary,
    ...(overrideReason ? { overrideReason: overrideReason.trim() } : {}),
    completedAt: now,
  };
}

/**
 * Build the completion report for an explicit, user-justified override.
 *
 * Hard secret/auth boundaries are never overridable (§13.2): the check must
 * have passed, otherwise this throws instead of producing a report.
 */
export function completionOverrideReport(
  result: CompletionPipelineResult,
  snapshot: PlanSnapshot,
  reason: string,
): CompletionReport {
  if (!canOverrideCompletion(result.checks)) {
    throw new Error(
      "Harte Secret-/Auth-Grenzen können nicht übersteuert werden.",
    );
  }
  return {
    version: 1 as const,
    completionId: randomUUID(),
    planId: snapshot.planId,
    planRevision: snapshot.planRevision,
    planHash: snapshot.planHash,
    diffHash: result.diffHash,
    outcome: "override" as const,
    reviewerVerdict: result.reviewer.verdict,
    checks: reportChecks(result.checks),
    scopeFindings: result.scopeFindings,
    residualRisks: result.residualRisks,
    reviewerSummary: result.reviewer.summary,
    overrideReason: reason.trim(),
    completedAt: new Date().toISOString(),
  };
}
