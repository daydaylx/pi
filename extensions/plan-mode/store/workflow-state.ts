/**
 * Workflow state v3: parsing, loading and CAS-guarded writes.
 *
 * Every persistent mutation runs through here (Umbauvertrag §13.3). `done` is
 * set exclusively by commitWorkflowDone after a passed completion pipeline.
 */
import { randomUUID } from "node:crypto";
import { existsSync, unlinkSync } from "node:fs";
import {
  extractPlanSnapshotSteps,
  hashPlanSnapshotContent,
  parsePlanSnapshot,
  type PlanKind,
  type PlanSnapshot,
} from "../plan-snapshot.ts";
import {
  COMPLETION_REPORT_RELATIVE_PATH,
  PLAN_RELATIVE_PATH,
  WORKFLOW_STATE_RELATIVE_PATH,
  isRecord,
  workflowPath,
} from "./paths.ts";
import { readBounded, serialize, tokenFor, writeAtomic } from "./atomic-files.ts";
import { withWorkflowLock } from "./locks.ts";
import {
  HASH_PATTERN,
  MAX_PLAN_BYTES,
  MAX_STATE_BYTES,
  REQUIRED_PASS_CHECKS,
  UUID_PATTERN,
  WORKFLOW_STATE_VERSION,
  type CompletionReport,
  type LegacyState,
  type WorkflowCompletionState,
  type WorkflowStateLoadResult,
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
  if (
    value.status !== "idle" &&
    value.status !== "planning" &&
    value.status !== "working" &&
    value.status !== "reviewing" &&
    value.status !== "paused" &&
    value.status !== "blocked" &&
    value.status !== "done"
  ) {
    return undefined;
  }
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

function reconcileSteps(
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

function loadRawState(cwd: string): {
  raw?: string;
  parsed?: WorkflowStateV3;
  legacy?: LegacyState;
} {
  const statePath = workflowPath(cwd, WORKFLOW_STATE_RELATIVE_PATH);
  const raw = readBounded(cwd, statePath, MAX_STATE_BYTES);
  if (raw === undefined) return {};
  try {
    const value = JSON.parse(raw) as unknown;
    const parsed = parseWorkflowStateV3(value);
    if (parsed) return { raw, parsed };
    if (isRecord(value) && (value.version === 1 || value.version === 2)) {
      return { raw, legacy: value as LegacyState };
    }
    return { raw };
  } catch {
    return { raw };
  }
}

export function loadWorkflowStateV3(cwd: string): WorkflowStateLoadResult {
  const planPath = workflowPath(cwd, PLAN_RELATIVE_PATH);
  const planContent = readBounded(cwd, planPath, MAX_PLAN_BYTES);
  const rawState = loadRawState(cwd);
  const warnings: string[] = [];
  if (planContent === undefined) {
    if (rawState.raw !== undefined) {
      warnings.push(
        "Workflow-Sidecar ohne aktiven Plan bleibt zur manuellen Recovery erhalten.",
      );
    }
    return {
      stateToken: tokenFor(rawState.raw),
      recovered: false,
      migrationRequired: Boolean(rawState.legacy),
      warnings,
    };
  }
  if (rawState.legacy) {
    return {
      planContent,
      stateToken: tokenFor(rawState.raw),
      recovered: false,
      migrationRequired: true,
      warnings: [
        "Workflow-State v1/v2 muss vor weiterer Arbeit ausdrücklich nach v3 migriert werden.",
      ],
    };
  }
  const parsedPlan = parsePlanSnapshot(planContent);
  const snapshot = parsedPlan.snapshot;
  if (!snapshot) {
    warnings.push(
      ...parsedPlan.diagnostics.map((diagnostic) => diagnostic.message),
    );
    return {
      planContent,
      state: rawState.parsed,
      stateToken: tokenFor(rawState.raw),
      recovered: false,
      migrationRequired: false,
      warnings,
    };
  }
  if (!rawState.parsed) {
    if (rawState.raw !== undefined) {
      warnings.push(
        "Ungültiger v3-Sidecar wurde nicht als Erfolg interpretiert; der Plan benötigt erneute Bestätigung.",
      );
    }
    return {
      planContent,
      snapshot,
      state: createWorkflowState(snapshot),
      stateToken: tokenFor(rawState.raw),
      recovered: true,
      migrationRequired: false,
      warnings,
    };
  }
  const current = rawState.parsed;
  if (
    current.planId !== snapshot.planId ||
    current.planRevision !== snapshot.planRevision ||
    current.planHash !== snapshot.planHash
  ) {
    warnings.push(
      "Planrevision oder Plan-Hash hat sich geändert; Bestätigung und Review wurden invalidiert.",
    );
    return {
      planContent,
      snapshot,
      state: createWorkflowState(snapshot, current),
      stateToken: tokenFor(rawState.raw),
      recovered: true,
      migrationRequired: false,
      warnings,
    };
  }
  const reconciled = reconcileSteps(current, snapshot.steps);
  if (JSON.stringify(reconciled) !== JSON.stringify(current.steps)) {
    warnings.push(
      "Fortschritt wurde konservativ gegen die stabilen Step-IDs abgeglichen.",
    );
    return {
      planContent,
      snapshot,
      state: {
        ...current,
        revision: current.revision + 1,
        status: current.status === "done" ? "planning" : current.status,
        reviewedPlanHash: undefined,
        completion: undefined,
        steps: reconciled,
        updatedAt: new Date().toISOString(),
      },
      stateToken: tokenFor(rawState.raw),
      recovered: true,
      migrationRequired: false,
      warnings,
    };
  }
  return {
    planContent,
    snapshot,
    state: current,
    stateToken: tokenFor(rawState.raw),
    recovered: false,
    migrationRequired: false,
    warnings,
  };
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
      throw new Error("Workflow-State hat sich konkurrierend geändert.");
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
      throw new Error(
        "Workflow-State hat sich vor der Planaktualisierung geändert.",
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
      throw new Error("Plan wurde konkurrierend geändert.");
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
      throw new Error("Workflow-State hat sich während der Planung geändert.");
    }
    const planPath = workflowPath(cwd, PLAN_RELATIVE_PATH);
    const currentPlan = readBounded(cwd, planPath, MAX_PLAN_BYTES);
    if (currentPlan !== observedPlanContent) {
      throw new Error(
        "Plan hat sich nach dem beobachteten Agent-Turn geändert.",
      );
    }
    writeAtomic(cwd, planPath, snapshot.content, MAX_PLAN_BYTES);
    const state = createWorkflowState(snapshot, previous);
    writeStateUnchecked(cwd, state);
    return { state, stateToken: tokenFor(serialize(state)) };
  });
}

export function commitWorkflowDone(
  cwd: string,
  state: WorkflowStateV3,
  expectedToken: string,
  report: CompletionReport,
): { state: WorkflowStateV3; stateToken: string } {
  if (state.status !== "reviewing") {
    throw new Error("Completion darf nur aus dem Status reviewing committen.");
  }
  if (
    report.outcome === "passed" &&
    state.steps.some((step) => step.status !== "completed")
  ) {
    throw new Error(
      "Ein bestandener Abschluss benötigt vollständig erledigte Schritte.",
    );
  }
  if (report.outcome === "passed" && report.reviewerVerdict !== "PASS") {
    throw new Error("Ein bestandener Abschluss benötigt Reviewer-PASS.");
  }
  if (report.outcome === "passed") {
    const checks = new Map(report.checks.map((check) => [check.name, check]));
    const missing = [...REQUIRED_PASS_CHECKS].filter(
      (name) => checks.get(name)?.status !== "pass",
    );
    if (missing.length > 0) {
      throw new Error(
        `Ein bestandener Abschluss benötigt erfolgreiche Pflichtnachweise: ${missing.join(", ")}.`,
      );
    }
    if (
      report.checks.some(
        (check) =>
          (check.classification === "required" && check.status !== "pass") ||
          (check.classification === "recommended" && check.status === "fail"),
      )
    ) {
      throw new Error(
        "Ein bestandener Abschluss enthält blockierende Prüfresultate.",
      );
    }
  }
  if (
    report.outcome === "override" &&
    (!report.overrideReason || report.overrideReason.trim() === "")
  ) {
    throw new Error("Ein Override benötigt eine Begründung.");
  }
  if (
    report.checks.find((check) => check.name === "hard-boundaries")?.status !==
    "pass"
  ) {
    throw new Error(
      "Harte Secret-/Auth-Grenzen können nicht übersteuert werden.",
    );
  }
  return withWorkflowLock(cwd, () => {
    if (currentStateToken(cwd) !== expectedToken) {
      throw new Error("Workflow-State hat sich vor done geändert.");
    }
    const plan = readBounded(
      cwd,
      workflowPath(cwd, PLAN_RELATIVE_PATH),
      MAX_PLAN_BYTES,
    );
    if (!plan || hashPlanSnapshotContent(plan) !== state.planHash) {
      throw new Error("Plan hat sich vor done geändert.");
    }
    if (
      report.planId !== state.planId ||
      report.planRevision !== state.planRevision ||
      report.planHash !== state.planHash
    ) {
      throw new Error(
        "Abschlussbericht gehört nicht zur aktiven Planrevision.",
      );
    }
    const completion: WorkflowCompletionState = {
      outcome: report.outcome,
      diffHash: report.diffHash,
      reviewerVerdict: report.reviewerVerdict,
      ...(report.overrideReason
        ? { overrideReason: report.overrideReason.trim() }
        : {}),
      completedAt: report.completedAt,
    };
    const next: WorkflowStateV3 = {
      ...state,
      revision: state.revision + 1,
      status: "done",
      activeStepId: undefined,
      reviewedPlanHash:
        report.reviewerVerdict === "PASS" ? state.planHash : undefined,
      completion,
      updatedAt: new Date().toISOString(),
    };
    writeAtomic(
      cwd,
      workflowPath(cwd, COMPLETION_REPORT_RELATIVE_PATH),
      serialize(report),
      MAX_STATE_BYTES,
    );
    writeStateUnchecked(cwd, next);
    return { state: next, stateToken: tokenFor(serialize(next)) };
  });
}
