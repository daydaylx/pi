/**
 * Versioned, atomic workflow state stored next to current-plan.md.
 *
 * The Markdown plan remains the source of truth. Sidecar v2 adds stable plan
 * identity, lifecycle and todo fingerprints; v1 is migrated conservatively.
 */

import { randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { relative, resolve, sep } from "node:path";
import type { WorkflowMode, WorkflowPhase } from "../shared/workflow-status.ts";
import {
  computeTodoHash,
  ensurePlanDirectory,
  extractTodoItems,
  hashPlanContent,
  inferPlanType,
  parsePlanMetadata,
  readPlanFileState,
  type PlanType,
} from "./utils.ts";

export const WORKFLOW_STATE_VERSION = 2 as const;
export const WORKFLOW_STATE_RELATIVE_PATH = ".agent/plans/current-plan.state.json";
export const WORKFLOW_LOCK_RELATIVE_PATH = ".agent/plans/.workflow.lock";
const WORKFLOW_LOCK_STALE_MS = 5 * 60 * 1000;

export type PlanProgressStatus = "in_progress" | "completed" | "blocked";
export type WorkflowLifecycle =
  | "work_idle"
  | "planning"
  | "deciding"
  | "reviewing"
  | "reviewed"
  | "executing"
  | "paused"
  | "blocked"
  | "ready";

export interface PlanProgressRecord {
  step: number;
  status: PlanProgressStatus;
  evidence: string;
  updatedAt: string;
  /** Stable fingerprint of the referenced todo. Filled before persistence. */
  todoHash?: string;
}

export interface WorkflowExecutionMetadata {
  executionId: string;
  startedAt: string;
  expectedPlanHash: string;
  sessionId?: string;
  runId?: string;
}

export interface WorkflowSidecarState {
  version: typeof WORKFLOW_STATE_VERSION;
  revision: number;
  planId: string;
  planHash: string;
  planType: PlanType;
  lifecycle: WorkflowLifecycle;
  mode: WorkflowMode;
  /** Compatibility projection for existing callers. */
  phase: WorkflowPhase;
  reviewedHash?: string;
  /** Compatibility alias. Unknown plans intentionally omit this field. */
  planCreationMode?: "simple_plan" | "detailed_plan";
  decisionBriefHash?: string;
  execution?: WorkflowExecutionMetadata;
  progress: PlanProgressRecord[];
  updatedAt: string;
}

export interface LoadedWorkflowState {
  state?: WorkflowSidecarState;
  recovered: boolean;
  warning?: string;
}

interface WorkflowSidecarV1 {
  version: 1;
  planHash: string;
  mode: WorkflowMode;
  phase: WorkflowPhase;
  reviewedHash?: string;
  planCreationMode?: "simple_plan" | "detailed_plan";
  progress: PlanProgressRecord[];
  updatedAt: string;
}

export interface WorkflowLockHandle {
  path: string;
  release(): void;
}

const MODES = new Set<WorkflowMode>(["work", "simple_plan", "detailed_plan"]);
const PHASES = new Set<WorkflowPhase>([
  "idle", "draft", "deciding", "reviewing", "reviewed", "executing", "paused", "blocked", "ready",
]);
const LIFECYCLES = new Set<WorkflowLifecycle>([
  "work_idle", "planning", "deciding", "reviewing", "reviewed", "executing", "paused", "blocked", "ready",
]);
const PROGRESS_STATUSES = new Set<PlanProgressStatus>([
  "in_progress", "completed", "blocked",
]);
const PLAN_TYPES = new Set<PlanType>(["simple_plan", "detailed_plan", "unknown"]);
const HASH_PATTERN = /^[0-9a-f]{64}$/i;

function isInside(basePath: string, candidatePath: string): boolean {
  const rel = relative(basePath, candidatePath);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== "..");
}

function assertSafeStatePath(cwd: string, statePath: string): void {
  const root = resolve(cwd);
  if (!isInside(root, statePath)) {
    throw new Error(`Workflow state escapes working directory: ${statePath}`);
  }
  const rel = relative(root, statePath);
  let current = root;
  for (const segment of rel.split(sep).filter(Boolean)) {
    current = resolve(current, segment);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw new Error(`Symbolic links are not allowed in workflow state paths: ${current}`);
    }
  }
}

export function getWorkflowStatePath(cwd: string): string {
  return resolve(cwd, WORKFLOW_STATE_RELATIVE_PATH);
}

export function getWorkflowLockPath(cwd: string): string {
  return resolve(cwd, WORKFLOW_LOCK_RELATIVE_PATH);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseProgressRecord(
  value: unknown,
  requireTodoHash: boolean,
): PlanProgressRecord | undefined {
  if (!isRecord(value)) return undefined;
  if (!Number.isSafeInteger(value.step) || Number(value.step) <= 0) return undefined;
  if (typeof value.status !== "string" || !PROGRESS_STATUSES.has(value.status as PlanProgressStatus)) return undefined;
  if (typeof value.evidence !== "string" || value.evidence.trim() === "") return undefined;
  if (typeof value.updatedAt !== "string") return undefined;
  if (requireTodoHash && (typeof value.todoHash !== "string" || !HASH_PATTERN.test(value.todoHash))) return undefined;
  if (value.todoHash !== undefined && (typeof value.todoHash !== "string" || !HASH_PATTERN.test(value.todoHash))) return undefined;
  return {
    step: Number(value.step),
    status: value.status as PlanProgressStatus,
    evidence: value.evidence,
    updatedAt: value.updatedAt,
    ...(typeof value.todoHash === "string" ? { todoHash: value.todoHash } : {}),
  };
}

function parseExecution(value: unknown): WorkflowExecutionMetadata | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.executionId !== "string" || value.executionId.trim() === "") return undefined;
  if (typeof value.startedAt !== "string") return undefined;
  if (typeof value.expectedPlanHash !== "string" || !HASH_PATTERN.test(value.expectedPlanHash)) return undefined;
  if (value.sessionId !== undefined && typeof value.sessionId !== "string") return undefined;
  if (value.runId !== undefined && typeof value.runId !== "string") return undefined;
  return {
    executionId: value.executionId,
    startedAt: value.startedAt,
    expectedPlanHash: value.expectedPlanHash,
    ...(typeof value.sessionId === "string" ? { sessionId: value.sessionId } : {}),
    ...(typeof value.runId === "string" ? { runId: value.runId } : {}),
  };
}

function parseV1(value: unknown): WorkflowSidecarV1 | undefined {
  if (!isRecord(value) || value.version !== 1) return undefined;
  if (typeof value.planHash !== "string" || !HASH_PATTERN.test(value.planHash)) return undefined;
  if (typeof value.mode !== "string" || !MODES.has(value.mode as WorkflowMode)) return undefined;
  if (typeof value.phase !== "string" || !PHASES.has(value.phase as WorkflowPhase)) return undefined;
  if (value.reviewedHash !== undefined && typeof value.reviewedHash !== "string") return undefined;
  if (value.planCreationMode !== undefined && value.planCreationMode !== "simple_plan" && value.planCreationMode !== "detailed_plan") return undefined;
  if (!Array.isArray(value.progress) || typeof value.updatedAt !== "string") return undefined;
  const progress = value.progress.map((record) => parseProgressRecord(record, false));
  if (progress.some((record) => record === undefined)) return undefined;
  return {
    version: 1,
    planHash: value.planHash,
    mode: value.mode as WorkflowMode,
    phase: value.phase as WorkflowPhase,
    ...(typeof value.reviewedHash === "string" ? { reviewedHash: value.reviewedHash } : {}),
    ...(value.planCreationMode ? { planCreationMode: value.planCreationMode as "simple_plan" | "detailed_plan" } : {}),
    progress: progress as PlanProgressRecord[],
    updatedAt: value.updatedAt,
  };
}

function parseWorkflowState(value: unknown): WorkflowSidecarState | undefined {
  if (!isRecord(value) || value.version !== WORKFLOW_STATE_VERSION) return undefined;
  if (!Number.isSafeInteger(value.revision) || Number(value.revision) <= 0) return undefined;
  if (typeof value.planId !== "string" || value.planId.trim() === "") return undefined;
  if (typeof value.planHash !== "string" || !HASH_PATTERN.test(value.planHash)) return undefined;
  if (typeof value.planType !== "string" || !PLAN_TYPES.has(value.planType as PlanType)) return undefined;
  if (typeof value.lifecycle !== "string" || !LIFECYCLES.has(value.lifecycle as WorkflowLifecycle)) return undefined;
  if (typeof value.mode !== "string" || !MODES.has(value.mode as WorkflowMode)) return undefined;
  if (typeof value.phase !== "string" || !PHASES.has(value.phase as WorkflowPhase)) return undefined;
  if (value.reviewedHash !== undefined && (typeof value.reviewedHash !== "string" || !HASH_PATTERN.test(value.reviewedHash))) return undefined;
  if (value.decisionBriefHash !== undefined && (typeof value.decisionBriefHash !== "string" || !HASH_PATTERN.test(value.decisionBriefHash))) return undefined;
  if (value.planCreationMode !== undefined && value.planCreationMode !== "simple_plan" && value.planCreationMode !== "detailed_plan") return undefined;
  if (!Array.isArray(value.progress) || typeof value.updatedAt !== "string") return undefined;
  const progress = value.progress.map((record) => parseProgressRecord(record, true));
  if (progress.some((record) => record === undefined)) return undefined;
  const execution = value.execution === undefined ? undefined : parseExecution(value.execution);
  if (value.execution !== undefined && !execution) return undefined;
  const lifecycle = value.lifecycle as WorkflowLifecycle;
  if (value.phase !== compatibilityPhase(lifecycle)) return undefined;
  if ((lifecycle === "executing") !== Boolean(execution)) return undefined;
  if (execution?.expectedPlanHash !== undefined && execution.expectedPlanHash !== value.planHash) {
    return undefined;
  }
  if (
    ["work_idle", "executing", "paused", "blocked", "ready"].includes(lifecycle) &&
    value.mode !== "work"
  ) {
    return undefined;
  }
  if (lifecycle === "reviewed" && value.reviewedHash !== value.planHash) return undefined;
  if (
    value.planCreationMode !== undefined &&
    value.planCreationMode !== value.planType
  ) {
    return undefined;
  }
  const validProgress = progress as PlanProgressRecord[];
  if (new Set(validProgress.map((record) => record.step)).size !== validProgress.length) {
    return undefined;
  }
  if (validProgress.filter((record) => record.status === "in_progress").length > 1) {
    return undefined;
  }
  return {
    version: WORKFLOW_STATE_VERSION,
    revision: Number(value.revision),
    planId: value.planId,
    planHash: value.planHash,
    planType: value.planType as PlanType,
    lifecycle,
    mode: value.mode as WorkflowMode,
    phase: value.phase as WorkflowPhase,
    ...(typeof value.reviewedHash === "string" ? { reviewedHash: value.reviewedHash } : {}),
    ...(value.planCreationMode ? { planCreationMode: value.planCreationMode as "simple_plan" | "detailed_plan" } : {}),
    ...(typeof value.decisionBriefHash === "string" ? { decisionBriefHash: value.decisionBriefHash } : {}),
    ...(execution ? { execution } : {}),
    progress: validProgress,
    updatedAt: value.updatedAt,
  };
}

function lifecycleForPhase(mode: WorkflowMode, phase: WorkflowPhase): WorkflowLifecycle {
  switch (phase) {
    case "idle": return mode === "work" ? "work_idle" : "planning";
    case "draft": return "planning";
    case "deciding": return "deciding";
    case "reviewing": return "reviewing";
    case "reviewed": return "reviewed";
    case "executing": return "executing";
    case "paused": return "paused";
    case "blocked": return "blocked";
    case "ready": return "ready";
  }
}

function compatibilityPhase(lifecycle: WorkflowLifecycle): WorkflowPhase {
  switch (lifecycle) {
    case "work_idle": return "idle";
    case "planning": return "draft";
    case "deciding": return "deciding";
    case "reviewing": return "reviewing";
    case "reviewed": return "reviewed";
    case "executing": return "executing";
    case "ready": return "ready";
    case "paused": return "paused";
    case "blocked": return "blocked";
  }
}

function conservativePlanType(planContent: string, previous?: PlanType): PlanType {
  const inferred = inferPlanType(planContent);
  if (previous === "detailed_plan" || inferred === "detailed_plan") return "detailed_plan";
  if (previous === "simple_plan" || inferred === "simple_plan") return "simple_plan";
  return "unknown";
}

function creationMode(planType: PlanType): "simple_plan" | "detailed_plan" | undefined {
  return planType === "unknown" ? undefined : planType;
}

export function reconstructWorkflowState(
  planContent: string,
  now = new Date(),
  previous?: { planType?: PlanType; planId?: string; revision?: number },
): WorkflowSidecarState {
  const todos = extractTodoItems(planContent);
  const allComplete = todos.length > 0 && todos.every((todo) => todo.completed);
  const planType = conservativePlanType(planContent, previous?.planType);
  const updatedAt = now.toISOString();
  return {
    version: WORKFLOW_STATE_VERSION,
    revision: Math.max(1, (previous?.revision ?? 0) + 1),
    planId: previous?.planId ?? parsePlanMetadata(planContent)?.planId ?? randomUUID(),
    planHash: hashPlanContent(planContent),
    planType,
    lifecycle: allComplete ? "ready" : "planning",
    mode: "work",
    phase: allComplete ? "ready" : "draft",
    ...(creationMode(planType) ? { planCreationMode: creationMode(planType) } : {}),
    progress: todos.filter((todo) => todo.completed).map((todo) => ({
      step: todo.step,
      todoHash: computeTodoHash(todo),
      status: "completed",
      evidence: "Aus Markdown-Checkbox rekonstruiert.",
      updatedAt,
    })),
    updatedAt,
  };
}

function migrateV1(
  legacy: WorkflowSidecarV1,
  planContent: string,
  hashMatches: boolean,
  now = new Date(),
): WorkflowSidecarState {
  if (!hashMatches) {
    return reconstructWorkflowState(planContent, now, {
      planType: legacy.planCreationMode,
      revision: 0,
    });
  }
  const todos = extractTodoItems(planContent);
  const planType = conservativePlanType(planContent, legacy.planCreationMode);
  const lifecycle = legacy.phase === "executing"
    ? "paused"
    : lifecycleForPhase(legacy.mode, legacy.phase);
  const progress = legacy.progress.flatMap((record) => {
    const todo = todos.find((candidate) => candidate.step === record.step);
    return todo ? [{ ...record, todoHash: computeTodoHash(todo) }] : [];
  });
  return {
    version: WORKFLOW_STATE_VERSION,
    revision: 1,
    planId: parsePlanMetadata(planContent)?.planId ?? randomUUID(),
    planHash: hashPlanContent(planContent),
    planType,
    lifecycle,
    mode: legacy.mode,
    phase: compatibilityPhase(lifecycle),
    ...(legacy.reviewedHash === hashPlanContent(planContent) ? { reviewedHash: legacy.reviewedHash } : {}),
    ...(creationMode(planType) ? { planCreationMode: creationMode(planType) } : {}),
    progress,
    updatedAt: now.toISOString(),
  };
}

/** Load and conservatively normalize sidecar state. Persisting is left to the caller. */
export function loadWorkflowState(cwd: string): LoadedWorkflowState {
  const plan = readPlanFileState(cwd);
  const statePath = getWorkflowStatePath(cwd);
  assertSafeStatePath(cwd, statePath);
  if (plan.status === "unreadable") throw new Error(plan.error);
  if (plan.status === "missing") {
    if (existsSync(statePath)) unlinkSync(statePath);
    return { state: undefined, recovered: false };
  }
  if (!existsSync(statePath)) {
    return { state: reconstructWorkflowState(plan.content), recovered: true };
  }
  try {
    const raw = JSON.parse(readFileSync(statePath, "utf8")) as unknown;
    const currentHash = hashPlanContent(plan.content);
    const parsed = parseWorkflowState(raw);
    if (parsed) {
      if (parsed.planHash !== currentHash) {
        return {
          state: reconstructWorkflowState(plan.content, new Date(), {
            planType: parsed.planType,
            planId: parsed.planId,
            revision: parsed.revision,
          }),
          recovered: true,
          warning: "Workflow-Sidecar war veraltet und wurde konservativ rekonstruiert.",
        };
      }
      if (parsed.lifecycle === "executing") {
        return {
          state: {
            ...parsed,
            revision: parsed.revision + 1,
            lifecycle: "paused",
            phase: "paused",
            execution: undefined,
            updatedAt: new Date().toISOString(),
          },
          recovered: true,
          warning: "Gespeicherte Planausführung wurde pausiert und muss explizit fortgesetzt werden.",
        };
      }
      return { state: parsed, recovered: false };
    }
    const legacy = parseV1(raw);
    if (legacy) {
      return {
        state: migrateV1(legacy, plan.content, legacy.planHash === currentHash),
        recovered: true,
        warning: legacy.planHash === currentHash
          ? "Workflow-Sidecar wurde von v1 auf v2 migriert."
          : "Veralteter v1-Sidecar wurde konservativ aus dem aktuellen Plan migriert.",
      };
    }
    return {
      state: reconstructWorkflowState(plan.content),
      recovered: true,
      warning: "Workflow-Sidecar war ungültig und wurde aus Markdown rekonstruiert.",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      state: reconstructWorkflowState(plan.content),
      recovered: true,
      warning: `Workflow-Sidecar konnte nicht gelesen werden und wurde rekonstruiert: ${message}`,
    };
  }
}

export function writeWorkflowStateAtomic(cwd: string, state: WorkflowSidecarState): void {
  const root = resolve(cwd);
  const statePath = getWorkflowStatePath(root);
  ensurePlanDirectory(root);
  assertSafeStatePath(root, statePath);
  if (!parseWorkflowState(state)) throw new Error("Workflow-Sidecar v2 ist ungültig.");
  const mode = existsSync(statePath) ? statSync(statePath).mode & 0o777 : 0o600;
  const temporaryPath = `${statePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: "utf8", flag: "wx", mode,
    });
    renameSync(temporaryPath, statePath);
  } finally {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
}

export function removeWorkflowState(cwd: string): void {
  const statePath = getWorkflowStatePath(cwd);
  assertSafeStatePath(cwd, statePath);
  if (existsSync(statePath)) unlinkSync(statePath);
}

export function acquireWorkspaceLock(cwd: string): WorkflowLockHandle {
  const root = resolve(cwd);
  ensurePlanDirectory(root);
  const lockPath = getWorkflowLockPath(root);
  assertSafeStatePath(root, lockPath);
  try {
    mkdirSync(lockPath, { mode: 0o700 });
  } catch (error) {
    const code = isRecord(error) && typeof error.code === "string" ? error.code : undefined;
    if (code === "EEXIST") {
      const age = Date.now() - statSync(lockPath).mtimeMs;
      if (age <= WORKFLOW_LOCK_STALE_MS) {
        throw new Error("Workflow wird bereits von einer anderen Session geändert.");
      }
      try {
        rmdirSync(lockPath);
        mkdirSync(lockPath, { mode: 0o700 });
      } catch {
        throw new Error(
          "Veralteter Workflow-Lock konnte nicht sicher übernommen werden.",
        );
      }
    } else {
      throw error;
    }
  }
  let released = false;
  return {
    path: lockPath,
    release(): void {
      if (released) return;
      released = true;
      rmdirSync(lockPath);
    },
  };
}

export function withWorkspaceLock<T>(cwd: string, action: () => T): T {
  const lock = acquireWorkspaceLock(cwd);
  try {
    return action();
  } finally {
    lock.release();
  }
}

export function writeWorkflowStateAtomicCAS(
  cwd: string,
  state: WorkflowSidecarState,
  expected: { revision?: number; planHash?: string } = {},
): WorkflowSidecarState {
  return withWorkspaceLock(cwd, () => {
    const plan = readPlanFileState(cwd);
    if (plan.status !== "ok") {
      throw new Error(plan.status === "missing" ? "Plan fehlt; CAS-Schreibvorgang abgebrochen." : plan.error);
    }
    const planHash = hashPlanContent(plan.content);
    if (expected.planHash !== undefined && expected.planHash !== planHash) {
      throw new Error("Plan-Hash hat sich geändert; CAS-Schreibvorgang abgebrochen.");
    }
    if (state.planHash !== planHash) {
      throw new Error("Sidecar referenziert nicht den aktuellen Plan-Hash.");
    }
    const statePath = getWorkflowStatePath(cwd);
    assertSafeStatePath(cwd, statePath);
    let currentRevision = 0;
    if (existsSync(statePath)) {
      try {
        const raw = JSON.parse(readFileSync(statePath, "utf8")) as unknown;
        currentRevision = parseWorkflowState(raw)?.revision ?? (parseV1(raw) ? 0 : -1);
      } catch {
        currentRevision = -1;
      }
    }
    if (currentRevision < 0) throw new Error("Vorhandener Sidecar ist ungültig; CAS abgebrochen.");
    if (expected.revision !== undefined && currentRevision !== expected.revision) {
      throw new Error(`Sidecar-Revision hat sich geändert (erwartet ${expected.revision}, aktuell ${currentRevision}).`);
    }
    const next = { ...state, revision: currentRevision + 1, updatedAt: new Date().toISOString() };
    writeWorkflowStateAtomic(cwd, next);
    return next;
  });
}

/** Creates a v2 sidecar snapshot for the current Markdown plan. */
export function createWorkflowStateSnapshot(
  planContent: string,
  runtime: {
    mode: WorkflowMode;
    phase: WorkflowPhase;
    lifecycle?: WorkflowLifecycle;
    revision?: number;
    planId?: string;
    planType?: PlanType;
    reviewedHash?: string;
    planCreationMode?: "simple_plan" | "detailed_plan";
    decisionBriefHash?: string;
    execution?: WorkflowExecutionMetadata;
    progress?: readonly PlanProgressRecord[];
  },
  now = new Date(),
): WorkflowSidecarState {
  const todos = extractTodoItems(planContent);
  const byStep = new Map(todos.map((todo) => [todo.step, todo]));
  let activeSeen = false;
  const progress = (runtime.progress ?? []).flatMap((record) => {
    const todo = byStep.get(record.step);
    if (!todo) return [];
    const todoHash = computeTodoHash(todo);
    if (record.todoHash !== undefined && record.todoHash !== todoHash) return [];
    if (record.status === "in_progress") {
      if (activeSeen) return [];
      activeSeen = true;
    }
    return [{ ...record, todoHash }];
  });
  const inferred = inferPlanType(planContent);
  const requestedType = runtime.planType ?? runtime.planCreationMode;
  const planType = conservativePlanType(planContent, requestedType ?? inferred);
  const lifecycle = runtime.lifecycle ?? lifecycleForPhase(runtime.mode, runtime.phase);
  const metadata = parsePlanMetadata(planContent);
  return {
    version: WORKFLOW_STATE_VERSION,
    revision: Math.max(1, runtime.revision ?? 1),
    planId: runtime.planId ?? metadata?.planId ?? randomUUID(),
    planHash: hashPlanContent(planContent),
    planType,
    lifecycle,
    mode: runtime.mode,
    phase: compatibilityPhase(lifecycle),
    ...(runtime.reviewedHash ? { reviewedHash: runtime.reviewedHash } : {}),
    ...(creationMode(planType) ? { planCreationMode: creationMode(planType) } : {}),
    ...(runtime.decisionBriefHash ? { decisionBriefHash: runtime.decisionBriefHash } : {}),
    ...(runtime.execution ? { execution: runtime.execution } : {}),
    progress,
    updatedAt: now.toISOString(),
  };
}
