/**
 * Parsing and validation of the persisted workflow state.
 *
 * Strict on purpose: anything that does not match the v3 contract returns
 * undefined rather than a partially trusted object. A sidecar that cannot be
 * validated must never be read as a successful run — in particular `done`
 * requires a completion record whose reviewer verdict and reviewed plan hash
 * actually line up.
 */
import { isWorkflowStatus } from "../../shared/workflow-status.ts";
import { isRecord } from "./paths.ts";
import {
  HASH_PATTERN,
  WORKFLOW_STATE_VERSION,
  type WorkflowCompletionState,
  type WorkflowStateV3,
  type WorkflowStepState,
} from "./types.ts";

function parseStepState(value: unknown): WorkflowStepState | undefined {
  if (!isRecord(value) || typeof value.id !== "string") return undefined;
  if (
    value.status !== "pending" &&
    value.status !== "in_progress" &&
    value.status !== "completed" &&
    value.status !== "blocked"
  ) {
    return undefined;
  }
  if (value.evidence !== undefined && typeof value.evidence !== "string") {
    return undefined;
  }
  return {
    id: value.id,
    status: value.status,
    ...(typeof value.evidence === "string" && value.evidence.trim()
      ? { evidence: value.evidence.trim() }
      : {}),
  };
}

function parseCompletion(value: unknown): WorkflowCompletionState | undefined {
  if (!isRecord(value)) return undefined;
  if (value.outcome !== "passed" && value.outcome !== "override")
    return undefined;
  if (typeof value.diffHash !== "string" || !HASH_PATTERN.test(value.diffHash))
    return undefined;
  if (
    value.reviewerVerdict !== "PASS" &&
    value.reviewerVerdict !== "REWORK" &&
    value.reviewerVerdict !== "UNVERIFIABLE"
  ) {
    return undefined;
  }
  if (typeof value.completedAt !== "string") return undefined;
  if (
    value.overrideReason !== undefined &&
    typeof value.overrideReason !== "string"
  ) {
    return undefined;
  }
  if (value.outcome === "passed" && value.reviewerVerdict !== "PASS") {
    return undefined;
  }
  if (
    value.outcome === "override" &&
    (typeof value.overrideReason !== "string" ||
      value.overrideReason.trim() === "")
  ) {
    return undefined;
  }
  return {
    outcome: value.outcome,
    diffHash: value.diffHash,
    reviewerVerdict: value.reviewerVerdict,
    ...(typeof value.overrideReason === "string"
      ? { overrideReason: value.overrideReason }
      : {}),
    completedAt: value.completedAt,
  };
}

export function parseWorkflowStateV3(
  value: unknown,
): WorkflowStateV3 | undefined {
  if (!isRecord(value) || value.version !== WORKFLOW_STATE_VERSION)
    return undefined;
  if (!Number.isSafeInteger(value.revision) || Number(value.revision) < 1)
    return undefined;
  if (typeof value.planId !== "string" || value.planId.trim() === "")
    return undefined;
  if (
    !Number.isSafeInteger(value.planRevision) ||
    Number(value.planRevision) < 1
  ) {
    return undefined;
  }
  if (typeof value.planHash !== "string" || !HASH_PATTERN.test(value.planHash))
    return undefined;
  if (!isWorkflowStatus(value.status)) return undefined;
  if (!Array.isArray(value.steps) || typeof value.updatedAt !== "string")
    return undefined;
  const steps = value.steps.map(parseStepState);
  if (steps.some((step) => step === undefined)) return undefined;
  const validSteps = steps as WorkflowStepState[];
  if (new Set(validSteps.map((step) => step.id)).size !== validSteps.length)
    return undefined;
  if (validSteps.filter((step) => step.status === "in_progress").length > 1) {
    return undefined;
  }
  if (
    value.activeStepId !== undefined &&
    (typeof value.activeStepId !== "string" ||
      !validSteps.some((step) => step.id === value.activeStepId))
  ) {
    return undefined;
  }
  if (
    value.reviewedPlanHash !== undefined &&
    (typeof value.reviewedPlanHash !== "string" ||
      !HASH_PATTERN.test(value.reviewedPlanHash))
  ) {
    return undefined;
  }
  const completion =
    value.completion === undefined
      ? undefined
      : parseCompletion(value.completion);
  if (value.completion !== undefined && !completion) return undefined;
  if (
    value.status === "done" &&
    (!completion ||
      (completion.outcome === "passed" &&
        value.reviewedPlanHash !== value.planHash))
  ) {
    return undefined;
  }
  if (value.status !== "done" && completion) return undefined;
  return {
    version: WORKFLOW_STATE_VERSION,
    revision: Number(value.revision),
    planId: value.planId,
    planRevision: Number(value.planRevision),
    planHash: value.planHash,
    status: value.status,
    ...(typeof value.activeStepId === "string"
      ? { activeStepId: value.activeStepId }
      : {}),
    steps: validSteps,
    ...(typeof value.reviewedPlanHash === "string"
      ? { reviewedPlanHash: value.reviewedPlanHash }
      : {}),
    ...(completion ? { completion } : {}),
    updatedAt: value.updatedAt,
  };
}
