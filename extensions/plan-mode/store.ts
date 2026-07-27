import { createHash, randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import {
  extractPlanSnapshotSteps,
  hashPlanSnapshotContent,
  parsePlanSnapshot,
  ensurePlanStepIds,
  isSafeTechnicalScopeEntry,
  stampPlanSnapshotMetadata,
  type PlanKind,
  type PlanSnapshot,
  type PlanSnapshotMetadata,
} from "./plan-snapshot.ts";

export const WORKFLOW_STATE_VERSION = 3 as const;
export const PLAN_RELATIVE_PATH = ".agent/plans/current-plan.md";
export const WORKFLOW_STATE_RELATIVE_PATH =
  ".agent/plans/current-plan.state.json";
export const COMPLETION_REPORT_RELATIVE_PATH =
  ".agent/plans/current-plan.completion.json";
export const WORKFLOW_LOCK_RELATIVE_PATH = ".agent/plans/.workflow.lock";
export const PLAN_ARCHIVE_RELATIVE_DIR = ".agent/plans/archive";
export const MIGRATION_BACKUP_RELATIVE_DIR =
  ".agent/plans/migration-backup";
export const DIRECT_TASK_RELATIVE_PATH = ".agent/direct-task.json";

const MAX_PLAN_BYTES = 256 * 1024;
const MAX_STATE_BYTES = 512 * 1024;
const MAX_DIRECT_TASK_BYTES = 128 * 1024;
const HASH_PATTERN = /^[0-9a-f]{64}$/i;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type WorkflowStatus =
  | "idle"
  | "planning"
  | "working"
  | "reviewing"
  | "paused"
  | "blocked"
  | "done";

export type WorkflowStepStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "blocked";

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
  completedAt: string;
}

export interface WorkflowLockHandle {
  path: string;
  release(): void;
}

const REQUIRED_PASS_CHECKS = new Set([
  "plan-steps",
  "git-diff-check",
  "hard-boundaries",
  "technical-scope",
  "declared-verification",
  "independent-reviewer",
  "diff-stability",
]);

interface LegacyState {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInside(base: string, candidate: string): boolean {
  const rel = relative(base, candidate);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`));
}

function assertSafePath(cwd: string, candidate: string): void {
  const root = resolve(cwd);
  const target = resolve(candidate);
  if (!isInside(root, target)) {
    throw new Error(`Workflow-Pfad verlässt das Projekt: ${candidate}`);
  }
  const rel = relative(root, target);
  let current = root;
  for (const segment of rel.split(sep).filter(Boolean)) {
    current = resolve(current, segment);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw new Error(
        `Symbolische Links sind in Workflow-Pfaden nicht erlaubt: ${current}`,
      );
    }
  }
}

function ensureParent(cwd: string, path: string): void {
  const root = resolve(cwd);
  const parent = dirname(path);
  assertSafePath(root, parent);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  assertSafePath(root, parent);
}

function readBounded(
  cwd: string,
  path: string,
  maximumBytes: number,
): string | undefined {
  assertSafePath(cwd, path);
  if (!existsSync(path)) return undefined;
  const stat = lstatSync(path);
  if (!stat.isFile()) throw new Error(`Workflow-Artefakt ist keine Datei: ${path}`);
  if (stat.size > maximumBytes) {
    throw new Error(
      `Workflow-Artefakt ist zu groß (${stat.size} Bytes): ${path}`,
    );
  }
  const content = readFileSync(path, "utf8");
  if (Buffer.byteLength(content, "utf8") > maximumBytes) {
    throw new Error(`Workflow-Artefakt überschreitet die Größenbegrenzung: ${path}`);
  }
  return content;
}

function writeAtomic(
  cwd: string,
  path: string,
  content: string,
  maximumBytes: number,
): void {
  if (Buffer.byteLength(content, "utf8") > maximumBytes) {
    throw new Error(`Workflow-Artefakt ist zu groß: ${path}`);
  }
  ensureParent(cwd, path);
  assertSafePath(cwd, path);
  const mode = existsSync(path) ? statSync(path).mode & 0o777 : 0o600;
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}-${randomUUID()}`;
  try {
    writeFileSync(temporary, content, {
      encoding: "utf8",
      flag: "wx",
      mode,
    });
    renameSync(temporary, path);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

function serialize(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function tokenFor(raw: string | undefined): string {
  return raw === undefined
    ? "missing"
    : `sha256:${createHash("sha256").update(raw, "utf8").digest("hex")}`;
}

export function workflowPath(cwd: string, relativePath: string): string {
  const path = resolve(cwd, relativePath);
  assertSafePath(cwd, path);
  return path;
}

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

function parseCompletion(
  value: unknown,
): WorkflowCompletionState | undefined {
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
  if (
    value.outcome === "passed" &&
    value.reviewerVerdict !== "PASS"
  ) {
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
  if (
    validSteps.filter((step) => step.status === "in_progress").length > 1
  ) {
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
    value.completion === undefined ? undefined : parseCompletion(value.completion);
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
  const previous = new Map(
    (state?.steps ?? []).map((step) => [step.id, step]),
  );
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

export function acquireWorkflowLock(cwd: string): WorkflowLockHandle {
  const lockPath = workflowPath(cwd, WORKFLOW_LOCK_RELATIVE_PATH);
  ensureParent(cwd, lockPath);
  try {
    mkdirSync(lockPath, { mode: 0o700 });
  } catch {
    throw new Error(
      "Workflow-Lock ist belegt. Eine Übernahme erfolgt niemals zeitgesteuert; prüfe den aktiven Prozess oder nutze die bestätigte Recovery.",
    );
  }
  const ownerPath = join(lockPath, "owner.json");
  try {
    writeFileSync(
      ownerPath,
      serialize({
        pid: process.pid,
        ownerId: randomUUID(),
        createdAt: new Date().toISOString(),
      }),
      { encoding: "utf8", flag: "wx", mode: 0o600 },
    );
  } catch (error) {
    try {
      rmdirSync(lockPath);
    } catch {
      // The explicit recovery path handles a partially initialized lock.
    }
    throw error;
  }
  let released = false;
  return {
    path: lockPath,
    release(): void {
      if (released) return;
      released = true;
      if (existsSync(ownerPath)) unlinkSync(ownerPath);
      rmdirSync(lockPath);
    },
  };
}

export function withWorkflowLock<T>(cwd: string, action: () => T): T {
  const lock = acquireWorkflowLock(cwd);
  try {
    return action();
  } finally {
    lock.release();
  }
}

export function clearWorkflowLockAfterConfirmation(
  cwd: string,
  confirmed: boolean,
): void {
  if (!confirmed) throw new Error("Workflow-Lock wurde nicht bestätigt.");
  const lockPath = workflowPath(cwd, WORKFLOW_LOCK_RELATIVE_PATH);
  if (!existsSync(lockPath)) return;
  const entries = readdirSync(lockPath);
  if (entries.some((entry) => entry !== "owner.json")) {
    throw new Error("Workflow-Lock enthält unerwartete Dateien.");
  }
  const ownerPath = join(lockPath, "owner.json");
  if (existsSync(ownerPath)) unlinkSync(ownerPath);
  rmdirSync(lockPath);
}

function currentStateToken(cwd: string): string {
  const path = workflowPath(cwd, WORKFLOW_STATE_RELATIVE_PATH);
  return tokenFor(readBounded(cwd, path, MAX_STATE_BYTES));
}

function writeStateUnchecked(cwd: string, state: WorkflowStateV3): void {
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
      throw new Error("Workflow-State hat sich vor der Planaktualisierung geändert.");
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
      throw new Error("Plan hat sich nach dem beobachteten Agent-Turn geändert.");
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
    throw new Error("Ein bestandener Abschluss benötigt vollständig erledigte Schritte.");
  }
  if (
    report.outcome === "passed" &&
    report.reviewerVerdict !== "PASS"
  ) {
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
          (check.classification === "required" &&
            check.status !== "pass") ||
          (check.classification === "recommended" &&
            check.status === "fail"),
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
      throw new Error("Abschlussbericht gehört nicht zur aktiven Planrevision.");
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

function archiveFileName(report: CompletionReport): string {
  const stamp = report.completedAt
    .replace(/[:.]/g, "-")
    .replace("T", "-")
    .replace("Z", "");
  return `${stamp}-${report.planId ?? report.directTaskId ?? report.completionId}-current-plan.md`;
}

export function archiveCompletedWorkflow(
  cwd: string,
  state: WorkflowStateV3,
  expectedToken: string,
  report: CompletionReport,
): string {
  if (state.status !== "done" || !state.completion) {
    throw new Error("Nur ein persistierter done-State darf archiviert werden.");
  }
  return withWorkflowLock(cwd, () => {
    if (currentStateToken(cwd) !== expectedToken) {
      throw new Error("Workflow-State hat sich vor der Archivierung geändert.");
    }
    const planPath = workflowPath(cwd, PLAN_RELATIVE_PATH);
    const plan = readBounded(cwd, planPath, MAX_PLAN_BYTES);
    if (!plan || hashPlanSnapshotContent(plan) !== state.planHash) {
      throw new Error("Aktiver Plan stimmt nicht mehr mit done überein.");
    }
    const archiveDir = workflowPath(cwd, PLAN_ARCHIVE_RELATIVE_DIR);
    mkdirSync(archiveDir, { recursive: true, mode: 0o700 });
    assertSafePath(cwd, archiveDir);
    const archivePath = join(archiveDir, archiveFileName(report));
    const reportBlock =
      `\n---\n\n## Abschlussbericht\n\n` +
      `- Completion-ID: \`${report.completionId}\`\n` +
      `- Plan-Hash: \`${state.planHash}\`\n` +
      `- Ergebnis: ${report.outcome}\n` +
      `- Reviewer: ${report.reviewerVerdict}\n` +
      `- Diff-Hash: \`${report.diffHash}\`\n` +
      (report.overrideReason
        ? `- Override-Begründung: ${report.overrideReason}\n`
        : "") +
      `\n### Prüfungen\n\n` +
      report.checks
        .map(
          (check) =>
            `- ${check.status.toUpperCase()} [${check.classification}] ${check.name}: ${check.summary}`,
        )
        .join("\n") +
      `\n\n### Reviewer-Zusammenfassung\n\n${report.reviewerSummary}\n`;
    const archivedContent = `${plan.trimEnd()}${reportBlock}`;
    if (existsSync(archivePath)) {
      const existing = readBounded(cwd, archivePath, MAX_STATE_BYTES);
      if (existing !== archivedContent) {
        throw new Error("Vorhandenes Archiv mit gleicher Completion-ID weicht ab.");
      }
    } else {
      writeAtomic(cwd, archivePath, archivedContent, MAX_STATE_BYTES);
    }
    unlinkSync(planPath);
    const statePath = workflowPath(cwd, WORKFLOW_STATE_RELATIVE_PATH);
    if (existsSync(statePath)) unlinkSync(statePath);
    const reportPath = workflowPath(cwd, COMPLETION_REPORT_RELATIVE_PATH);
    if (existsSync(reportPath)) unlinkSync(reportPath);
    return archivePath;
  });
}

export function discardActiveWorkflow(
  cwd: string,
  expectedToken: string,
  confirmed: boolean,
): void {
  if (!confirmed) throw new Error("Verwerfen wurde nicht bestätigt.");
  withWorkflowLock(cwd, () => {
    if (currentStateToken(cwd) !== expectedToken) {
      throw new Error("Workflow-State hat sich vor dem Verwerfen geändert.");
    }
    for (const relativePath of [
      PLAN_RELATIVE_PATH,
      WORKFLOW_STATE_RELATIVE_PATH,
      COMPLETION_REPORT_RELATIVE_PATH,
    ]) {
      const path = workflowPath(cwd, relativePath);
      if (existsSync(path)) unlinkSync(path);
    }
  });
}

function legacyPlanType(legacy: LegacyState, content: string): PlanKind {
  if (
    legacy.planType === "detailed_plan" ||
    legacy.planType === "simple_plan"
  ) {
    return legacy.planType;
  }
  return /##\s+(?:\d+\.\s*)?(?:Nicht-Ziele|Betroffene Bereiche|Tests \/ Checks)/i.test(
    content,
  )
    ? "detailed_plan"
    : "simple_plan";
}

function legacyStatus(legacy: LegacyState): WorkflowStatus {
  const value = legacy.lifecycle ?? legacy.phase;
  if (value === "blocked") return "blocked";
  if (
    value === "executing" ||
    value === "paused" ||
    value === "ready"
  ) {
    return "paused";
  }
  return "planning";
}

function hasLiveLegacyLease(legacy: LegacyState, now: Date): boolean {
  const expires = legacy.execution?.leaseExpiresAt;
  return (
    typeof legacy.execution?.ownerId === "string" &&
    typeof expires === "string" &&
    Number.isFinite(Date.parse(expires)) &&
    Date.parse(expires) > now.getTime()
  );
}

function migrationBackupDir(cwd: string, now: Date): string {
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  return workflowPath(cwd, join(MIGRATION_BACKUP_RELATIVE_DIR, stamp));
}

export function migrateLegacyWorkflowToV3(
  cwd: string,
  options: {
    confirmedLegacySessionsClosed: boolean;
    now?: Date;
  },
): WorkflowStateLoadResult {
  if (!options.confirmedLegacySessionsClosed) {
    throw new Error(
      "Migration benötigt die Bestätigung, dass ältere Pi-Sessions geschlossen sind.",
    );
  }
  const now = options.now ?? new Date();
  return withWorkflowLock(cwd, () => {
    const planPath = workflowPath(cwd, PLAN_RELATIVE_PATH);
    const statePath = workflowPath(cwd, WORKFLOW_STATE_RELATIVE_PATH);
    const plan = readBounded(cwd, planPath, MAX_PLAN_BYTES);
    const stateRaw = readBounded(cwd, statePath, MAX_STATE_BYTES);
    if (!plan || !stateRaw) {
      throw new Error("Legacy-Plan oder -Sidecar fehlt.");
    }
    let legacy: LegacyState;
    try {
      const parsed = JSON.parse(stateRaw) as unknown;
      if (!isRecord(parsed) || (parsed.version !== 1 && parsed.version !== 2)) {
        throw new Error("Kein migrierbarer v1/v2-State.");
      }
      legacy = parsed as LegacyState;
    } catch (error) {
      throw new Error(
        `Legacy-State ist nicht sicher migrierbar: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (hasLiveLegacyLease(legacy, now)) {
      throw new Error(
        "Eine aktive v2-Execution-Lease blockiert die Migration.",
      );
    }
    const backupDir = migrationBackupDir(cwd, now);
    mkdirSync(backupDir, { recursive: true, mode: 0o700 });
    copyFileSync(planPath, join(backupDir, basename(planPath)));
    copyFileSync(statePath, join(backupDir, basename(statePath)));

    const planType = legacyPlanType(legacy, plan);
    const withIds = ensurePlanStepIds(plan);
    const metadata: PlanSnapshotMetadata = {
      version: 3,
      planId:
        typeof legacy.planId === "string" && UUID_PATTERN.test(legacy.planId)
          ? legacy.planId
          : randomUUID(),
      planRevision: 1,
      planType,
    };
    const migratedPlan = stampPlanSnapshotMetadata(withIds, metadata);
    const steps = extractPlanSnapshotSteps(migratedPlan);
    const progress = Array.isArray(legacy.progress) ? legacy.progress : [];
    const stepStates = steps.map((step, index): WorkflowStepState => {
      const record = progress.find(
        (candidate) => Number(candidate.step) === index + 1,
      );
      const status =
        record?.status === "completed"
          ? "completed"
          : record?.status === "blocked"
            ? "blocked"
            : "pending";
      return {
        id: step.id,
        status,
        ...(typeof record?.evidence === "string" && record.evidence.trim()
          ? { evidence: record.evidence.trim() }
          : {}),
      };
    });
    const state: WorkflowStateV3 = {
      version: 3,
      revision: 1,
      planId: metadata.planId,
      planRevision: metadata.planRevision,
      planHash: hashPlanSnapshotContent(migratedPlan),
      status: legacyStatus(legacy),
      steps: stepStates,
      updatedAt: now.toISOString(),
    };
    writeAtomic(cwd, planPath, migratedPlan, MAX_PLAN_BYTES);
    writeStateUnchecked(cwd, state);
    const parsed = parsePlanSnapshot(migratedPlan);
    return {
      planContent: migratedPlan,
      snapshot: parsed.snapshot,
      state,
      stateToken: tokenFor(serialize(state)),
      recovered: true,
      migrationRequired: false,
      warnings: parsed.snapshot
        ? ["Workflow-State wurde konservativ von v1/v2 nach v3 migriert."]
        : [
            "Workflow-State wurde nach v3 migriert; der Legacy-Plan bleibt in planning, bis fehlende v3-Vertragsabschnitte ergänzt wurden.",
            ...parsed.diagnostics.map((diagnostic) => diagnostic.message),
          ],
    };
  });
}

function parseStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) &&
    value.every((entry) => typeof entry === "string" && entry.trim())
    ? value.map((entry) => entry.trim())
    : undefined;
}

export function parseDirectTask(value: unknown): DirectTask | undefined {
  if (!isRecord(value) || value.version !== 1) return undefined;
  const scope = parseStringArray(value.technicalScope);
  const verification = parseStringArray(value.verification);
  const acceptance = parseStringArray(value.acceptanceCriteria);
  if (
    typeof value.taskId !== "string" ||
    typeof value.goal !== "string" ||
    !value.goal.trim() ||
    !scope ||
    !scope.every(isSafeTechnicalScopeEntry) ||
    !verification ||
    !acceptance ||
    typeof value.updatedAt !== "string"
  ) {
    return undefined;
  }
  return {
    version: 1,
    taskId: value.taskId,
    goal: value.goal.trim(),
    technicalScope: scope,
    verification,
    acceptanceCriteria: acceptance,
    updatedAt: value.updatedAt,
  };
}

export function loadDirectTask(cwd: string): DirectTask | undefined {
  const raw = readBounded(
    cwd,
    workflowPath(cwd, DIRECT_TASK_RELATIVE_PATH),
    MAX_DIRECT_TASK_BYTES,
  );
  if (raw === undefined) return undefined;
  try {
    const parsed = parseDirectTask(JSON.parse(raw) as unknown);
    if (!parsed) throw new Error("Direct Task ist ungültig.");
    return parsed;
  } catch (error) {
    throw new Error(
      `Direct Task kann nicht gelesen werden: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function saveDirectTask(
  cwd: string,
  task: Omit<DirectTask, "version" | "taskId" | "updatedAt"> &
    Partial<Pick<DirectTask, "taskId">>,
): DirectTask {
  const value: DirectTask = {
    version: 1,
    taskId: task.taskId ?? randomUUID(),
    goal: task.goal.trim(),
    technicalScope: [...task.technicalScope],
    verification: [...task.verification],
    acceptanceCriteria: [...task.acceptanceCriteria],
    updatedAt: new Date().toISOString(),
  };
  if (!parseDirectTask(value)) throw new Error("Direct Task ist ungültig.");
  writeAtomic(
    cwd,
    workflowPath(cwd, DIRECT_TASK_RELATIVE_PATH),
    serialize(value),
    MAX_DIRECT_TASK_BYTES,
  );
  return value;
}

export function clearDirectTask(cwd: string): void {
  const path = workflowPath(cwd, DIRECT_TASK_RELATIVE_PATH);
  if (existsSync(path)) unlinkSync(path);
}
