/**
 * Versioned, atomic workflow state stored next to current-plan.md.
 *
 * The Markdown plan remains the source of truth. A missing, malformed or stale
 * sidecar can therefore always be rebuilt conservatively from its structure
 * and checkboxes.
 */

import {
  existsSync,
  lstatSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { relative, resolve, sep } from "node:path";
import type {
  WorkflowMode,
  WorkflowPhase,
} from "../shared/workflow-status.ts";
import {
  ensurePlanDirectory,
  extractTodoItems,
  hashPlanContent,
  readPlanFile,
  validatePlanStructure,
} from "./utils.ts";

export const WORKFLOW_STATE_VERSION = 1 as const;
export const WORKFLOW_STATE_RELATIVE_PATH =
  ".agent/plans/current-plan.state.json";

export type PlanProgressStatus = "in_progress" | "completed" | "blocked";

export interface PlanProgressRecord {
  step: number;
  status: PlanProgressStatus;
  evidence: string;
  updatedAt: string;
}

export interface WorkflowSidecarState {
  version: typeof WORKFLOW_STATE_VERSION;
  planHash: string;
  mode: WorkflowMode;
  phase: WorkflowPhase;
  reviewedHash?: string;
  planCreationMode?: "simple_plan" | "detailed_plan";
  progress: PlanProgressRecord[];
  updatedAt: string;
}

export interface LoadedWorkflowState {
  state?: WorkflowSidecarState;
  recovered: boolean;
  warning?: string;
}

const MODES = new Set<WorkflowMode>([
  "work",
  "simple_plan",
  "detailed_plan",
]);
const PHASES = new Set<WorkflowPhase>([
  "idle",
  "draft",
  "deciding",
  "reviewing",
  "reviewed",
  "executing",
  "ready",
]);
const PROGRESS_STATUSES = new Set<PlanProgressStatus>([
  "in_progress",
  "completed",
  "blocked",
]);

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
      throw new Error(
        `Symbolic links are not allowed in workflow state paths: ${current}`,
      );
    }
  }
}

export function getWorkflowStatePath(cwd: string): string {
  return resolve(cwd, WORKFLOW_STATE_RELATIVE_PATH);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseProgressRecord(value: unknown): PlanProgressRecord | undefined {
  if (!isRecord(value)) return undefined;
  if (!Number.isSafeInteger(value.step) || Number(value.step) <= 0)
    return undefined;
  if (
    typeof value.status !== "string" ||
    !PROGRESS_STATUSES.has(value.status as PlanProgressStatus)
  )
    return undefined;
  if (typeof value.evidence !== "string" || value.evidence.trim() === "")
    return undefined;
  if (typeof value.updatedAt !== "string") return undefined;
  return {
    step: Number(value.step),
    status: value.status as PlanProgressStatus,
    evidence: value.evidence,
    updatedAt: value.updatedAt,
  };
}

function parseWorkflowState(value: unknown): WorkflowSidecarState | undefined {
  if (!isRecord(value) || value.version !== WORKFLOW_STATE_VERSION)
    return undefined;
  if (typeof value.planHash !== "string" || value.planHash.length !== 64)
    return undefined;
  if (typeof value.mode !== "string" || !MODES.has(value.mode as WorkflowMode))
    return undefined;
  if (
    typeof value.phase !== "string" ||
    !PHASES.has(value.phase as WorkflowPhase)
  )
    return undefined;
  if (
    value.reviewedHash !== undefined &&
    typeof value.reviewedHash !== "string"
  )
    return undefined;
  if (
    value.planCreationMode !== undefined &&
    value.planCreationMode !== "simple_plan" &&
    value.planCreationMode !== "detailed_plan"
  )
    return undefined;
  if (!Array.isArray(value.progress) || typeof value.updatedAt !== "string")
    return undefined;

  const progress = value.progress.map(parseProgressRecord);
  if (progress.some((record) => record === undefined)) return undefined;

  return {
    version: WORKFLOW_STATE_VERSION,
    planHash: value.planHash,
    mode: value.mode as WorkflowMode,
    phase: value.phase as WorkflowPhase,
    ...(typeof value.reviewedHash === "string"
      ? { reviewedHash: value.reviewedHash }
      : {}),
    ...(value.planCreationMode
      ? {
          planCreationMode: value.planCreationMode as
            | "simple_plan"
            | "detailed_plan",
        }
      : {}),
    progress: progress as PlanProgressRecord[],
    updatedAt: value.updatedAt,
  };
}

export function reconstructWorkflowState(
  planContent: string,
  now = new Date(),
): WorkflowSidecarState {
  const todos = extractTodoItems(planContent);
  const allComplete =
    todos.length > 0 && todos.every((todo) => todo.completed);
  const detailed =
    validatePlanStructure(planContent, "detailed_plan").length === 0;
  const updatedAt = now.toISOString();

  return {
    version: WORKFLOW_STATE_VERSION,
    planHash: hashPlanContent(planContent),
    // Markdown encodes the plan shape, but not the currently selected UI
    // mode. Recover into work mode so merely opening a repository never
    // silently changes the user's mode or thinking level.
    mode: "work",
    phase: allComplete ? "ready" : "draft",
    planCreationMode: detailed ? "detailed_plan" : "simple_plan",
    progress: todos
      .filter((todo) => todo.completed)
      .map((todo) => ({
        step: todo.step,
        status: "completed",
        evidence: "Aus Markdown-Checkbox rekonstruiert.",
        updatedAt,
      })),
    updatedAt,
  };
}

/**
 * Loads a current sidecar. Invalid or hash-stale state is replaced in memory
 * by a conservative Markdown reconstruction; the caller persists the
 * normalized result after applying session-specific recovery rules.
 */
export function loadWorkflowState(cwd: string): LoadedWorkflowState {
  const content = readPlanFile(cwd);
  const statePath = getWorkflowStatePath(cwd);
  assertSafeStatePath(cwd, statePath);

  if (content === undefined) {
    if (existsSync(statePath)) unlinkSync(statePath);
    return { state: undefined, recovered: false };
  }

  if (!existsSync(statePath)) {
    return { state: reconstructWorkflowState(content), recovered: true };
  }

  try {
    const parsed = parseWorkflowState(
      JSON.parse(readFileSync(statePath, "utf8")) as unknown,
    );
    if (!parsed) {
      return {
        state: reconstructWorkflowState(content),
        recovered: true,
        warning: "Workflow-Sidecar war ungültig und wurde aus Markdown rekonstruiert.",
      };
    }
    if (parsed.planHash !== hashPlanContent(content)) {
      return {
        state: reconstructWorkflowState(content),
        recovered: true,
        warning:
          "Workflow-Sidecar war veraltet und wurde aus dem aktuellen Markdown-Plan rekonstruiert.",
      };
    }
    return { state: parsed, recovered: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      state: reconstructWorkflowState(content),
      recovered: true,
      warning: `Workflow-Sidecar konnte nicht gelesen werden und wurde rekonstruiert: ${message}`,
    };
  }
}

export function writeWorkflowStateAtomic(
  cwd: string,
  state: WorkflowSidecarState,
): void {
  const root = resolve(cwd);
  const statePath = getWorkflowStatePath(root);
  ensurePlanDirectory(root);
  assertSafeStatePath(root, statePath);

  const mode = existsSync(statePath)
    ? statSync(statePath).mode & 0o777
    : 0o600;
  const temporaryPath = `${statePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode,
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

/** Creates a sidecar snapshot for the current Markdown plan. */
export function createWorkflowStateSnapshot(
  planContent: string,
  runtime: {
    mode: WorkflowMode;
    phase: WorkflowPhase;
    reviewedHash?: string;
    planCreationMode?: "simple_plan" | "detailed_plan";
    progress?: readonly PlanProgressRecord[];
  },
  now = new Date(),
): WorkflowSidecarState {
  const validSteps = new Set(
    extractTodoItems(planContent).map((todo) => todo.step),
  );
  const progress = (runtime.progress ?? []).filter((record) =>
    validSteps.has(record.step),
  );
  return {
    version: WORKFLOW_STATE_VERSION,
    planHash: hashPlanContent(planContent),
    mode: runtime.mode,
    phase: runtime.phase,
    ...(runtime.reviewedHash
      ? { reviewedHash: runtime.reviewedHash }
      : {}),
    ...(runtime.planCreationMode
      ? { planCreationMode: runtime.planCreationMode }
      : {}),
    progress: [...progress],
    updatedAt: now.toISOString(),
  };
}
