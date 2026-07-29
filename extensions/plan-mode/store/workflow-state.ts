/**
 * Workflow state v3: the public facade and every CAS-guarded write.
 *
 * Every persistent mutation runs through here (Umbauvertrag §13.3). Each write
 * takes the workflow lock, re-reads the state token and re-checks that the plan
 * on disk still hashes to the state's planHash — a state that no longer matches
 * its plan is refused rather than written. `done` is set exclusively by
 * commitWorkflowDone in workflow-done.ts.
 *
 * Parsing lives in workflow-state-schema.ts, state construction in
 * workflow-state-factory.ts, loading and recovery in workflow-state-load.ts.
 */
import {
  hashPlanSnapshotContent,
  type PlanSnapshot,
} from "../plan-snapshot.ts";
import {
  PLAN_RELATIVE_PATH,
  WORKFLOW_STATE_RELATIVE_PATH,
  workflowPath,
} from "./paths.ts";
import {
  readBounded,
  serialize,
  tokenFor,
  writeAtomic,
} from "./atomic-files.ts";
import { withWorkflowLock } from "./locks.ts";
import { createWorkflowState } from "./workflow-state-factory.ts";
import { parseWorkflowStateV3 } from "./workflow-state-schema.ts";
import {
  MAX_PLAN_BYTES,
  MAX_STATE_BYTES,
  type WorkflowStateV3,
} from "./types.ts";

export { createWorkflowState } from "./workflow-state-factory.ts";
export { parseWorkflowStateV3 } from "./workflow-state-schema.ts";
export { loadWorkflowStateV3 } from "./workflow-state-load.ts";
// commitWorkflowDone is deliberately NOT re-exported here: it needs the CAS
// primitives from this module, so re-exporting it would close an import cycle.
// store/index.ts publishes it directly from ./workflow-done.ts.

/**
 * Thrown by every CAS write when the on-disk state or plan no longer matches
 * what the caller observed. `reason` tells the two checks apart so callers can
 * word a user-facing message precisely, but neither reason implies it is safe
 * to bypass CAS and write anyway — the on-disk side always won the race.
 */
export class WorkflowConcurrencyError extends Error {
  constructor(
    message: string,
    readonly reason: "state-changed" | "plan-changed",
  ) {
    super(message);
    this.name = "WorkflowConcurrencyError";
  }
}

export function currentStateToken(cwd: string): string {
  const path = workflowPath(cwd, WORKFLOW_STATE_RELATIVE_PATH);
  return tokenFor(readBounded(cwd, path, MAX_STATE_BYTES));
}

export function writeStateUnchecked(cwd: string, state: WorkflowStateV3): void {
  if (!parseWorkflowStateV3(state)) {
    throw new Error("Workflow-State v3 ist ungültig.");
  }
  writeAtomic(
    cwd,
    workflowPath(cwd, WORKFLOW_STATE_RELATIVE_PATH),
    serialize(state),
    MAX_STATE_BYTES,
  );
}

export function writeWorkflowStateCAS(
  cwd: string,
  state: WorkflowStateV3,
  expectedToken: string,
): { state: WorkflowStateV3; stateToken: string } {
  if (state.status === "done") {
    throw new Error(
      "Status done darf ausschließlich über commitWorkflowDone gesetzt werden.",
    );
  }
  return withWorkflowLock(cwd, () => {
    if (currentStateToken(cwd) !== expectedToken) {
      throw new WorkflowConcurrencyError(
        "Workflow-State hat sich konkurrierend geändert.",
        "state-changed",
      );
    }
    const plan = readBounded(
      cwd,
      workflowPath(cwd, PLAN_RELATIVE_PATH),
      MAX_PLAN_BYTES,
    );
    if (!plan || hashPlanSnapshotContent(plan) !== state.planHash) {
      throw new Error("Workflow-State referenziert nicht den aktuellen Plan.");
    }
    const next: WorkflowStateV3 = {
      ...state,
      revision: Math.max(1, state.revision + 1),
      updatedAt: new Date().toISOString(),
    };
    writeStateUnchecked(cwd, next);
    return {
      state: next,
      stateToken: tokenFor(serialize(next)),
    };
  });
}

export function writePlanAndStateCAS(
  cwd: string,
  snapshot: PlanSnapshot,
  previousStateToken: string,
  previous?: WorkflowStateV3,
): { state: WorkflowStateV3; stateToken: string } {
  return withWorkflowLock(cwd, () => {
    if (currentStateToken(cwd) !== previousStateToken) {
      throw new WorkflowConcurrencyError(
        "Workflow-State hat sich vor der Planaktualisierung geändert.",
        "state-changed",
      );
    }
    const planPath = workflowPath(cwd, PLAN_RELATIVE_PATH);
    const currentPlan = readBounded(cwd, planPath, MAX_PLAN_BYTES);
    if (
      currentPlan !== undefined &&
      currentPlan !== snapshot.content &&
      previous?.planHash &&
      hashPlanSnapshotContent(currentPlan) !== previous.planHash
    ) {
      throw new WorkflowConcurrencyError(
        "Plan wurde konkurrierend geändert.",
        "plan-changed",
      );
    }
    writeAtomic(cwd, planPath, snapshot.content, MAX_PLAN_BYTES);
    const state = createWorkflowState(snapshot, previous);
    writeStateUnchecked(cwd, state);
    return { state, stateToken: tokenFor(serialize(state)) };
  });
}

/**
 * Adopts exactly the plan bytes observed after an agent planning turn. This is
 * the only CAS path that accepts an intentional agent edit to the plan file.
 */
export function finalizeObservedPlanCAS(
  cwd: string,
  observedPlanContent: string,
  snapshot: PlanSnapshot,
  previousStateToken: string,
  previous?: WorkflowStateV3,
): { state: WorkflowStateV3; stateToken: string } {
  return withWorkflowLock(cwd, () => {
    if (currentStateToken(cwd) !== previousStateToken) {
      throw new WorkflowConcurrencyError(
        "Workflow-State hat sich während der Planung geändert.",
        "state-changed",
      );
    }
    const planPath = workflowPath(cwd, PLAN_RELATIVE_PATH);
    const currentPlan = readBounded(cwd, planPath, MAX_PLAN_BYTES);
    if (currentPlan !== observedPlanContent) {
      throw new WorkflowConcurrencyError(
        "Plan hat sich nach dem beobachteten Agent-Turn geändert.",
        "plan-changed",
      );
    }
    writeAtomic(cwd, planPath, snapshot.content, MAX_PLAN_BYTES);
    const state = createWorkflowState(snapshot, previous);
    writeStateUnchecked(cwd, state);
    return { state, stateToken: tokenFor(serialize(state)) };
  });
}
