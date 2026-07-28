/**
 * Building a workflow state from a PlanSnapshot.
 *
 * Pure — no file system access. Progress is reconciled against the stable step
 * ids conservatively: unknown steps start over as pending and a second
 * in_progress step is demoted, because two active steps would make the
 * execution contract ambiguous.
 */
import type { PlanSnapshot } from "../plan-snapshot.ts";
import {
  WORKFLOW_STATE_VERSION,
  type WorkflowStateV3,
  type WorkflowStepState,
} from "./types.ts";

export function reconcileSteps(
  state: WorkflowStateV3 | undefined,
  snapshotSteps: readonly { id: string }[],
): WorkflowStepState[] {
  const previous = new Map((state?.steps ?? []).map((step) => [step.id, step]));
  const next = snapshotSteps.map((step) => {
    const existing = previous.get(step.id);
    return existing
      ? { ...existing }
      : { id: step.id, status: "pending" as const };
  });
  let activeSeen = false;
  for (const step of next) {
    if (step.status !== "in_progress") continue;
    if (activeSeen) {
      step.status = "pending";
      delete step.evidence;
    } else {
      activeSeen = true;
    }
  }
  return next;
}

export function createWorkflowState(
  snapshot: Pick<
    PlanSnapshot,
    "planId" | "planRevision" | "planHash" | "steps"
  >,
  previous?: WorkflowStateV3,
  now = new Date(),
): WorkflowStateV3 {
  const samePlan =
    previous?.planId === snapshot.planId &&
    previous.planRevision === snapshot.planRevision &&
    previous.planHash === snapshot.planHash;
  const steps = reconcileSteps(previous, snapshot.steps);
  return {
    version: WORKFLOW_STATE_VERSION,
    revision: Math.max(1, (previous?.revision ?? 0) + 1),
    planId: snapshot.planId,
    planRevision: snapshot.planRevision,
    planHash: snapshot.planHash,
    status: samePlan ? previous.status : "planning",
    ...(samePlan &&
    previous.activeStepId &&
    steps.some((step) => step.id === previous.activeStepId)
      ? { activeStepId: previous.activeStepId }
      : {}),
    steps,
    ...(samePlan && previous.reviewedPlanHash
      ? { reviewedPlanHash: previous.reviewedPlanHash }
      : {}),
    ...(samePlan && previous.completion
      ? { completion: previous.completion }
      : {}),
    updatedAt: now.toISOString(),
  };
}
