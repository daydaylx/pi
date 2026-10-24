import { readFileGoal } from "./file-readback.mjs";
import {
  normalizeSystemGoal,
  readApplyJob,
  readSystemGoal,
  systemGoalForTool,
} from "./state-readback.mjs";
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

export const RUN_STATES = Object.freeze([
  "ACCEPTED",
  "INVESTIGATING",
  "EXECUTING",
  "VERIFYING",
  "WAITING_INPUT",
  "CANCELLING",
  "UNCERTAIN",
  "RECONCILING",
  "RESUMABLE",
  "SUCCEEDED",
  "FAILED",
  "BLOCKED",
  "CANCELLED",
]);

export const TERMINAL_RUN_STATES = new Set([
  "SUCCEEDED",
  "FAILED",
  "BLOCKED",
  "CANCELLED",
]);

export const ACTIVE_EXECUTION_STATES = new Set([
  "ACCEPTED",
  "INVESTIGATING",
  "EXECUTING",
  "VERIFYING",
  "WAITING_INPUT",
  "CANCELLING",
  "RECONCILING",
]);

const MUTATING_TOOLS = new Set([
  "bash",
  "edit",
  "write",
  "exec_root",
  "root_job",
  "desktop_exec",
  "desktop_switch_workspace",
  "desktop_focus_window",
  "audio_set_volume",
  "user_service",
  "nixos_build",
  "nixos_apply",
]);

const READ_ONLY_TOOLS = new Set([
  "read",
  "ls",
  "find",
  "grep",
  "nixos_status",
  "user_service_status",
  "system_unit_status",
  "system_journal",
  "desktop_state",
  "audio_status",
  "system_file_verify",
  "system_state_verify",
]);
const MAX_RUN_EVENTS = 200;
// Only an actual host-side readback can create positive goal evidence.
const READBACK_PROOF = Symbol("host-readback");
const HOST_PROOF_KINDS = new Set(["host-file-sha256", "host-system-state"]);

// Only an identical bounded read or a later host-proved file repair can
// resolve a failed attempt. Shell commands and unknown resources stay open.
function readIdentity(toolName, args) {
  if (
    toolName !== "read" ||
    typeof args?.path !== "string" ||
    !path.isAbsolute(args.path) ||
    [args.offset, args.limit].some(
      (value) => value !== undefined && (!Number.isInteger(value) || value < 1),
    )
  )
    return undefined;
  return JSON.stringify([args.path, args.offset ?? 1, args.limit ?? null]);
}

function hasOpenFailure(action) {
  return action.effectState === "failed" && !action.resolution;
}

function resolveFailedAttempts(record, repair, checkId) {
  const repairIndex = record.actions.indexOf(repair);
  for (const failed of record.actions.slice(0, repairIndex)) {
    if (!hasOpenFailure(failed)) continue;
    const sameRead =
      !failed.mutating &&
      !repair.mutating &&
      failed.readIdentity &&
      failed.readIdentity === repair.readIdentity;
    const provedFileRepair =
      checkId &&
      repair.completionMatched === true &&
      failed.mutating &&
      repair.mutating &&
      failed.targetPath &&
      failed.targetPath === repair.targetPath;
    if (!sameRead && !provedFileRepair) continue;
    failed.resolution = {
      actionId: repair.actionId,
      resolvedAt: new Date().toISOString(),
      ...(checkId ? { checkId } : {}),
    };
    // Remove only the issue belonging to this attempt; keep unrelated and
    // legacy issue text, and retain the original failed action unchanged.
    if (failed.issue) {
      record.remaining_issues = record.remaining_issues.filter(
        (issue) => issue !== failed.issue,
      );
    }
  }
}

function sanitizeTitle(raw, fallback = "Systemauftrag") {
  if (typeof raw !== "string") return fallback;
  const firstLine = raw
    .split(/\r?\n/)[0]
    .replace(/\p{Cc}+/gu, " ")
    .trim();
  if (!firstLine) return fallback;
  return firstLine.length > 160 ? `${firstLine.slice(0, 157)}...` : firstLine;
}

function atomicWriteJsonSync(targetPath, value) {
  const dir = path.dirname(targetPath);
  const base = path.basename(targetPath);
  const tempPath = path.join(dir, `.${base}.tmp.${randomUUID()}`);
  const payload = `${JSON.stringify(value, null, 2)}\n`;
  let fd;
  try {
    fd = openSync(tempPath, "w", 0o600);
    writeFileSync(fd, payload, "utf8");
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    chmodSync(tempPath, 0o600);
    renameSync(tempPath, targetPath);
    try {
      const dirFd = openSync(dir, "r");
      try {
        fsyncSync(dirFd);
      } finally {
        closeSync(dirFd);
      }
    } catch {
      // Directory fsync is best-effort across filesystems
    }
  } catch (error) {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // Ignore close error
      }
    }
    try {
      if (existsSync(tempPath)) unlinkSync(tempPath);
    } catch {
      // Ignore unlink error
    }
    throw error;
  }
}

function isValidPersistedRunRecord(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return false;
  }
  if (record.schemaVersion !== 1) return false;
  if (typeof record.runId !== "string" || !record.runId) return false;
  if (typeof record.sessionId !== "string" || !record.sessionId) return false;
  if (typeof record.title !== "string" || !record.title) return false;
  if (typeof record.createdAt !== "string" || !record.createdAt) return false;
  if (typeof record.updatedAt !== "string" || !record.updatedAt) return false;
  if (!Number.isInteger(record.revision) || record.revision < 1) return false;
  if (typeof record.hostEpoch !== "string" || !record.hostEpoch) return false;
  if (!RUN_STATES.includes(record.state)) return false;
  if (typeof record.stateReason !== "string" || !record.stateReason) {
    return false;
  }
  if (typeof record.lastStep !== "string" || !record.lastStep) return false;
  if (!Array.isArray(record.actions) || !Array.isArray(record.verification)) {
    return false;
  }
  if (!Array.isArray(record.events)) return false;
  return true;
}

function normalizeRunRecord(record) {
  if (typeof record.goal !== "string" || !record.goal) {
    record.goal = record.title;
  }
  if (!Array.isArray(record.source_of_truth)) {
    record.source_of_truth = [];
  }
  if (!Array.isArray(record.observations)) {
    record.observations = [];
  }
  if (
    !record.rollback ||
    typeof record.rollback !== "object" ||
    Array.isArray(record.rollback)
  ) {
    record.rollback = {
      available: false,
      strategy: null,
      ref: null,
      status: "none",
    };
  }
  if (!Array.isArray(record.remaining_issues)) {
    record.remaining_issues = [];
  }
  return record;
}

function addUniqueBounded(list, item, maxItems = 32) {
  if (typeof item !== "string" || !item.trim()) return;
  const cleaned = item.trim().slice(0, 500);
  if (!list.includes(cleaned) && list.length < maxItems) {
    list.push(cleaned);
  }
}

function applyOperatorReportFields(
  record,
  { source_of_truth, observations, rollback, remaining_issues } = {},
) {
  normalizeRunRecord(record);
  if (Array.isArray(source_of_truth)) {
    for (const entry of source_of_truth) {
      addUniqueBounded(record.source_of_truth, entry, 32);
    }
  }
  if (Array.isArray(observations)) {
    for (const entry of observations) {
      addUniqueBounded(record.observations, entry, 32);
    }
  }
  if (rollback && typeof rollback === "object" && !Array.isArray(rollback)) {
    record.rollback = {
      available: Boolean(rollback.available),
      strategy:
        typeof rollback.strategy === "string" ? rollback.strategy : null,
      ref: typeof rollback.ref === "string" ? rollback.ref : null,
      status:
        typeof rollback.status === "string" && rollback.status
          ? rollback.status
          : "none",
    };
  }
  if (Array.isArray(remaining_issues)) {
    record.remaining_issues = remaining_issues
      .filter((entry) => typeof entry === "string" && entry.trim().length > 0)
      .slice(0, 32)
      .map((entry) => entry.trim().slice(0, 1000));
  }
}

export function toPublicRunSnapshot(record) {
  normalizeRunRecord(record);
  const rest = { ...record };
  delete rest.pendingMessage;
  return structuredClone({
    schemaVersion: rest.schemaVersion,
    runId: rest.runId,
    sessionId: rest.sessionId,
    ...(typeof rest.clientSubmissionId === "string"
      ? { clientSubmissionId: rest.clientSubmissionId }
      : {}),
    title: rest.title,
    goal: rest.goal,
    createdAt: rest.createdAt,
    updatedAt: rest.updatedAt,
    revision: rest.revision,
    hostEpoch: rest.hostEpoch,
    state: rest.state,
    stateReason: rest.stateReason,
    lastStep: rest.lastStep,
    queued: rest.queued === true,
    requireVerification: rest.requireVerification === true,
    source_of_truth: [...rest.source_of_truth],
    actions: rest.actions.map((action) => ({
      actionId: action.actionId,
      toolCallId: action.toolCallId,
      toolName: action.toolName,
      mutating: action.mutating === true,
      startedAt: action.startedAt,
      ...(typeof action.finishedAt === "string"
        ? { finishedAt: action.finishedAt }
        : {}),
      effectState: action.effectState,
      ...(typeof action.reconcileNote === "string"
        ? { reconcileNote: action.reconcileNote }
        : {}),
    })),
    observations: [...rest.observations],
    verification: rest.verification.map((entry) => ({
      checkId: entry.checkId,
      status: entry.status,
      summary: entry.summary,
      recordedAt: entry.recordedAt,
      ...(typeof entry.evidenceRef === "string"
        ? { evidenceRef: entry.evidenceRef }
        : {}),
    })),
    rollback: structuredClone(rest.rollback),
    remaining_issues: [...rest.remaining_issues],
    result: rest.result ? structuredClone(rest.result) : null,
  });
}

export function toPublicRunSummary(record) {
  return {
    runId: record.runId,
    sessionId: record.sessionId,
    ...(typeof record.clientSubmissionId === "string"
      ? { clientSubmissionId: record.clientSubmissionId }
      : {}),
    title: record.title,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    revision: record.revision,
    state: record.state,
    stateReason: record.stateReason,
    lastStep: record.lastStep,
    queued: record.queued === true,
  };
}

export class RunStore {
  constructor({
    runsDir,
    hostEpoch,
    stateReader = readSystemGoal,
    jobReader = readApplyJob,
  }) {
    this.stateReader = stateReader;
    this.jobReader = jobReader;
    if (!runsDir || !path.isAbsolute(runsDir)) {
      throw new Error("runsDir must be an absolute path");
    }
    this.runsDir = runsDir;
    this.hostEpoch = hostEpoch;
    this.runs = new Map();
    this.submissionIndex = new Map();
    this.corruptedRuns = new Map();
    this.ensureDirectory();
  }

  ensureDirectory() {
    mkdirSync(this.runsDir, { recursive: true, mode: 0o700 });
    const stats = lstatSync(this.runsDir);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error("Run store path must be a real directory");
    }
    if ((stats.mode & 0o077) !== 0) {
      chmodSync(this.runsDir, 0o700);
    }
  }

  runFilePath(runId) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(runId)) {
      throw new Error(`Invalid runId: ${runId}`);
    }
    return path.join(this.runsDir, `${runId}.json`);
  }

  persist(record) {
    const filePath = this.runFilePath(record.runId);
    atomicWriteJsonSync(filePath, record);
    this.runs.set(record.runId, record);
    if (record.clientSubmissionId) {
      this.submissionIndex.set(
        `${record.sessionId}:${record.clientSubmissionId}`,
        record.runId,
      );
      this.submissionIndex.set(`*:${record.clientSubmissionId}`, record.runId);
    }
    return record;
  }

  appendRunEvent(record, eventName, extra = {}) {
    const entry = {
      revision: record.revision,
      timestamp: record.updatedAt,
      event: eventName,
      state: record.state,
      stateReason: record.stateReason,
      lastStep: record.lastStep,
      ...extra,
    };
    record.events.push(entry);
    if (record.events.length > MAX_RUN_EVENTS) {
      record.events.splice(0, record.events.length - MAX_RUN_EVENTS);
    }
    return entry;
  }

  loadAndReconcileStartup(newHostEpoch) {
    this.hostEpoch = newHostEpoch;
    this.runs.clear();
    this.submissionIndex.clear();
    this.corruptedRuns.clear();

    const entries = readdirSync(this.runsDir, { withFileTypes: true });
    const reconciledRuns = [];

    for (const entry of entries) {
      if (entry.name.startsWith(".") || !entry.name.endsWith(".json")) continue;
      const runIdFromName = entry.name.slice(0, -".json".length);
      const fullPath = path.join(this.runsDir, entry.name);
      try {
        const stats = lstatSync(fullPath);
        if (stats.isSymbolicLink() || !stats.isFile()) {
          this.corruptedRuns.set(runIdFromName, {
            runId: runIdFromName,
            fileName: entry.name,
            reason: "Run manifest is not a regular file",
            detectedAt: new Date().toISOString(),
          });
          continue;
        }
        const raw = readFileSync(fullPath, "utf8");
        const parsed = JSON.parse(raw);
        if (
          !isValidPersistedRunRecord(parsed) ||
          parsed.runId !== runIdFromName
        ) {
          this.corruptedRuns.set(runIdFromName, {
            runId: runIdFromName,
            fileName: entry.name,
            reason: "Run manifest failed schema validation",
            detectedAt: new Date().toISOString(),
          });
          continue;
        }
        normalizeRunRecord(parsed);

        if (
          !TERMINAL_RUN_STATES.has(parsed.state) &&
          parsed.state !== "UNCERTAIN" &&
          parsed.state !== "RESUMABLE"
        ) {
          const now = new Date().toISOString();
          parsed.updatedAt = now;
          parsed.revision += 1;
          parsed.state = "UNCERTAIN";
          parsed.stateReason = "HOST_RESTARTED_DURING_ACTIVE_RUN";
          parsed.lastStep = "host.restart_detected";
          parsed.queued = false;
          for (const action of parsed.actions) {
            if (
              action.effectState === "intended" ||
              action.effectState === "executing"
            ) {
              action.effectState = "unknown";
              action.finishedAt = now;
            }
          }
          parsed.result = {
            outcome: "uncertain",
            partial: parsed.actions.some((a) => a.effectState === "applied"),
            errorCode: "PI_CRASHED",
            message:
              "Host restarted while run was non-terminal; state inspection required before any retry",
            verificationRefs: parsed.verification
              .filter((v) => v.status === "passed")
              .map((v) => v.checkId),
          };
          this.appendRunEvent(parsed, "run.reconcile_required");
          this.persist(parsed);
          reconciledRuns.push(parsed);
        } else {
          this.runs.set(parsed.runId, parsed);
          if (parsed.clientSubmissionId) {
            this.submissionIndex.set(
              `${parsed.sessionId}:${parsed.clientSubmissionId}`,
              parsed.runId,
            );
            this.submissionIndex.set(
              `*:${parsed.clientSubmissionId}`,
              parsed.runId,
            );
          }
        }
      } catch {
        this.corruptedRuns.set(runIdFromName, {
          runId: runIdFromName,
          fileName: entry.name,
          reason: "Run manifest contains malformed JSON",
          detectedAt: new Date().toISOString(),
        });
      }
    }

    return reconciledRuns;
  }

  findBySubmissionId(sessionId, clientSubmissionId) {
    if (!clientSubmissionId) return undefined;
    const exactId =
      this.submissionIndex.get(`${sessionId}:${clientSubmissionId}`) ??
      this.submissionIndex.get(`*:${clientSubmissionId}`);
    if (!exactId) return undefined;
    return this.runs.get(exactId);
  }

  getRun(runId) {
    if (this.corruptedRuns.has(runId)) {
      const corrupt = this.corruptedRuns.get(runId);
      const err = new Error(
        `Corrupted run manifest for ${runId}: ${corrupt.reason}`,
      );
      err.code = "RUN_CORRUPT";
      throw err;
    }
    return this.runs.get(runId);
  }

  getActiveOrBlockingRun() {
    for (const run of this.runs.values()) {
      if (
        ACTIVE_EXECUTION_STATES.has(run.state) &&
        !(run.state === "ACCEPTED" && run.queued === true)
      ) {
        return run;
      }
    }
    for (const run of this.runs.values()) {
      if (run.state === "UNCERTAIN") {
        return run;
      }
    }
    return null;
  }

  getNextQueuedRun() {
    const queued = [...this.runs.values()]
      .filter((run) => run.state === "ACCEPTED" && run.queued === true)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return queued[0] ?? null;
  }

  createRun({
    sessionId,
    message,
    title,
    clientSubmissionId,
    requireVerification = false,
    queued = false,
  }) {
    const now = new Date().toISOString();
    const runId = `run_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
    const normalizedTitle = sanitizeTitle(title ?? message);
    const record = {
      schemaVersion: 1,
      runId,
      sessionId,
      ...(typeof clientSubmissionId === "string" &&
      clientSubmissionId.length > 0
        ? { clientSubmissionId }
        : {}),
      title: normalizedTitle,
      goal: sanitizeTitle(message ?? title, normalizedTitle),
      createdAt: now,
      updatedAt: now,
      revision: 1,
      hostEpoch: this.hostEpoch,
      state: "ACCEPTED",
      stateReason: queued ? "QUEUED" : "SUBMITTED",
      lastStep: queued ? "queued" : "accepted",
      queued: queued === true,
      requireVerification: requireVerification === true,
      pendingMessage: message,
      source_of_truth: [],
      actions: [],
      observations: [],
      verification: [],
      rollback: {
        available: false,
        strategy: null,
        ref: null,
        status: "none",
      },
      remaining_issues: [],
      result: null,
      events: [],
    };
    this.appendRunEvent(record, "run.created");
    return this.persist(record);
  }

  transition(
    record,
    { state, stateReason, lastStep, queued, result, eventName = "run.updated" },
  ) {
    const now = new Date().toISOString();
    record.updatedAt = now;
    record.revision += 1;
    if (state !== undefined) record.state = state;
    if (stateReason !== undefined) record.stateReason = stateReason;
    if (lastStep !== undefined) record.lastStep = lastStep;
    if (queued !== undefined) record.queued = queued;
    if (result !== undefined) record.result = result;
    if (TERMINAL_RUN_STATES.has(record.state)) {
      delete record.pendingMessage;
      record.queued = false;
    }
    this.appendRunEvent(record, eventName);
    return this.persist(record);
  }

  recordToolStarted(
    record,
    { toolCallId, toolName, args, systemTarget, externalJob = false },
  ) {
    normalizeRunRecord(record);
    const now = new Date().toISOString();
    const mutating =
      toolName === "system_job"
        ? !["status", "output"].includes(args?.action)
        : MUTATING_TOOLS.has(toolName) ||
          !READ_ONLY_TOOLS.has(toolName) ||
          externalJob === true;
    const action = {
      actionId: `act_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
      toolCallId: String(toolCallId || `tc_${record.actions.length + 1}`),
      toolName: String(toolName || "unknown"),
      mutating,
      externalJob: externalJob === true,
      ...(readIdentity(toolName, args)
        ? { readIdentity: readIdentity(toolName, args) }
        : {}),
      ...(typeof args?.path === "string" &&
      path.isAbsolute(args.path) &&
      ["write", "edit"].includes(toolName)
        ? { targetPath: args.path }
        : {}),
      startedAt: now,
      effectState: "executing",
    };
    record.actions.push(action);
    const target = systemTarget ?? systemGoalForTool(toolName, args);
    if (target) {
      const normalized = normalizeSystemGoal(target);
      // Do not let a target for another tool grant coverage to shell commands.
      const supported = {
        "user-service": "user_service",
        workspace: "desktop_switch_workspace",
        "nixos-generation": "nixos_apply",
      };
      if (supported[normalized.kind] === toolName) {
        action.systemTarget = normalized;
        if (
          normalized.kind === "user-service" &&
          normalized.operation === "restart"
        ) {
          try {
            action.beforeInvocationId =
              this.stateReader(normalized).observation.invocationId;
          } catch {
            /* Without a baseline a restart remains unverified. */
          }
        }
      }
    }
    if (mutating) {
      // Retire stale positive evidence rather than leaving a pending check
      // that a later tool call (with a fresh check ID) could never replace.
      record.verification = record.verification.filter(
        (check) => check.status !== "passed",
      );
    }
    if (args && typeof args === "object") {
      if (typeof args.path === "string") {
        addUniqueBounded(record.source_of_truth, args.path);
      } else if (typeof args.unit === "string") {
        addUniqueBounded(record.source_of_truth, `systemd:${args.unit}`);
      }
    }
    if (
      action.toolName === "nixos_status" ||
      action.toolName === "nixos_build" ||
      action.toolName === "nixos_apply"
    ) {
      addUniqueBounded(record.source_of_truth, "nixos:flake");
    }
    record.updatedAt = now;
    record.revision += 1;
    if (record.state !== "CANCELLING") {
      record.state = mutating ? "EXECUTING" : "INVESTIGATING";
      record.stateReason = mutating ? "TOOL_EXECUTING" : "TOOL_INVESTIGATING";
    }
    record.lastStep = `tool.started:${action.toolName}`;
    this.appendRunEvent(record, "run.updated");
    return this.persist(record);
  }

  recordToolFinished(record, { toolCallId, toolName, isError, externalJobId }) {
    normalizeRunRecord(record);
    const now = new Date().toISOString();
    const action =
      [...record.actions]
        .reverse()
        .find((a) => a.toolCallId === toolCallId && !a.finishedAt) ??
      [...record.actions].reverse().find((a) => !a.finishedAt);

    const resolvedName = String(toolName || action?.toolName || "unknown");
    if (action) {
      action.completionMatched =
        isError === false &&
        action.toolCallId === toolCallId &&
        action.toolName === resolvedName;
      if (
        action.toolName === "nixos_apply" &&
        typeof externalJobId === "string" &&
        /^pi-job-[0-9a-f-]{36}$/.test(externalJobId)
      ) {
        action.externalJobId = externalJobId;
        action.externalJob = true;
      }
      action.finishedAt = now;
      action.effectState = isError
        ? "failed"
        : action.externalJobId
          ? "executing"
          : action.mutating
            ? "applied"
            : "not_applied";
      if (!isError && !action.mutating) {
        if (action.completionMatched) resolveFailedAttempts(record, action);
        addUniqueBounded(
          record.observations,
          `${resolvedName} completed (${action.toolCallId})`,
        );
      }
    }
    if (isError) {
      const issue = action
        ? `Tool execution failed: ${resolvedName} (${action.actionId})`
        : `Tool execution failed: ${resolvedName}`;
      if (action) action.issue = issue;
      addUniqueBounded(record.remaining_issues, issue);
    }
    record.updatedAt = now;
    record.revision += 1;
    record.lastStep = isError
      ? `tool.failed:${resolvedName}`
      : `tool.completed:${resolvedName}`;
    if (isError && record.state !== "CANCELLING") {
      record.stateReason = "TOOL_EXECUTION_ERROR";
    }
    this.appendRunEvent(record, "run.updated");
    return this.persist(record);
  }

  recordVerification(
    record,
    {
      checkId,
      status,
      summary,
      evidenceRef,
      source_of_truth,
      observations,
      rollback,
      remaining_issues,
    },
    proof,
    proofDetails,
  ) {
    if (status === "passed" && proof !== READBACK_PROOF) {
      const error = new Error(
        "Positive verification requires a host-executed readback",
      );
      error.code = "PERMISSION_DENIED";
      throw error;
    }
    applyOperatorReportFields(record, {
      source_of_truth,
      observations,
      rollback,
      remaining_issues,
    });
    if (typeof evidenceRef === "string" && evidenceRef.length > 0) {
      addUniqueBounded(record.source_of_truth, evidenceRef);
    }
    if (status === "passed" && typeof summary === "string") {
      addUniqueBounded(record.observations, summary);
    } else if (status === "failed" && typeof summary === "string") {
      addUniqueBounded(
        record.remaining_issues,
        `Verification failed (${checkId}): ${summary}`,
      );
    }
    const now = new Date().toISOString();
    const existingIdx = record.verification.findIndex(
      (v) => v.checkId === checkId,
    );
    const entry = {
      checkId,
      status,
      summary,
      recordedAt: now,
      ...(proof === READBACK_PROOF
        ? {
            proofKind: proofDetails?.proofKind ?? "host-file-sha256",
            coveredActionIds:
              proofDetails?.coveredActionIds ??
              record.actions
                .filter(
                  (a) =>
                    a.mutating &&
                    a.targetPath === source_of_truth?.[0] &&
                    a.finishedAt &&
                    a.effectState === "applied",
                )
                .map((a) => a.actionId),
          }
        : {}),
      ...(typeof evidenceRef === "string" && evidenceRef.length > 0
        ? { evidenceRef }
        : {}),
    };
    if (existingIdx >= 0) {
      record.verification[existingIdx] = entry;
    } else {
      record.verification.push(entry);
    }
    if (status === "passed" && proof === READBACK_PROOF) {
      for (const action of record.actions) {
        if (
          action.effectState === "applied" &&
          entry.coveredActionIds?.includes(action.actionId)
        )
          resolveFailedAttempts(record, action, checkId);
      }
    }
    record.updatedAt = now;
    record.revision += 1;
    record.lastStep = `verification.${status}:${checkId}`;

    if (
      record.state === "VERIFYING" &&
      status === "passed" &&
      !record.actions.some(
        (a) =>
          !a.finishedAt || hasOpenFailure(a) || a.effectState === "unknown",
      ) &&
      record.actions
        .filter(
          (a) => a.mutating && a.effectState !== "not_applied" && !a.resolution,
        )
        .every((a) =>
          record.verification.some(
            (v) =>
              v.status === "passed" &&
              HOST_PROOF_KINDS.has(v.proofKind) &&
              v.coveredActionIds?.includes(a.actionId),
          ),
        ) &&
      !record.verification.some(
        (v) => v.status === "failed" || v.status === "pending",
      )
    ) {
      record.state = "SUCCEEDED";
      record.stateReason = "VERIFICATION_PASSED";
      record.result = {
        outcome: "succeeded",
        partial: false,
        message: summary || "Run goal verified and completed",
        verificationRefs: record.verification
          .filter((v) => v.status === "passed")
          .map((v) => v.checkId),
      };
      delete record.pendingMessage;
      this.appendRunEvent(record, "run.settled");
    } else if (status === "failed" && record.state === "VERIFYING") {
      record.state = "FAILED";
      record.stateReason = "VERIFICATION_FAILED";
      record.result = {
        outcome: "failed",
        partial: record.actions.some((a) => a.effectState === "applied"),
        errorCode: "TOOL_FAILED",
        message: summary || "Verification check failed",
        verificationRefs: record.verification
          .filter((v) => v.status === "passed")
          .map((v) => v.checkId),
      };
      delete record.pendingMessage;
      this.appendRunEvent(record, "run.settled");
    } else {
      this.appendRunEvent(record, "run.updated");
    }
    return this.persist(record);
  }

  // Trusted in-process operator entry point, deliberately unavailable over IPC.
  // Use only for a goal expressible as exact file contents. Other goals stay open.
  verifyFileReadback(record, { filePath, expectedSha256, checkId }) {
    if (
      !["VERIFYING", "INVESTIGATING", "EXECUTING"].includes(record.state) ||
      !checkId
    ) {
      const error = new Error(
        "Readback requires an executing or VERIFYING run",
      );
      error.code = "RUN_CONFLICT";
      throw error;
    }
    const { actualSha256: actual } = readFileGoal(filePath, expectedSha256);
    return this.recordVerification(
      record,
      {
        checkId,
        status: actual === expectedSha256 ? "passed" : "failed",
        summary:
          actual === expectedSha256
            ? "Host file readback matches expected SHA-256"
            : "Host file readback differs from expected SHA-256",
        evidenceRef: `sha256:${actual}`,
        source_of_truth: [filePath],
      },
      READBACK_PROOF,
    );
  }

  verifySystemReadback(record, { goal, checkId }) {
    if (
      !["VERIFYING", "INVESTIGATING", "EXECUTING"].includes(record.state) ||
      !checkId
    ) {
      const error = new Error(
        "Readback requires an executing or VERIFYING run",
      );
      error.code = "RUN_CONFLICT";
      throw error;
    }
    const normalized = normalizeSystemGoal(goal);
    const readback = this.stateReader(normalized);
    const sameResource = (target) =>
      target?.kind === normalized.kind &&
      (normalized.kind !== "user-service" || target.unit === normalized.unit);
    const resourceActions = record.actions.filter(
      (action) => action.mutating && sameResource(action.systemTarget),
    );
    const latestTargetMatches =
      JSON.stringify(resourceActions.at(-1)?.systemTarget) ===
      JSON.stringify(normalized);
    let jobPending = false;
    let jobFailed = false;
    if (normalized.kind === "nixos-generation") {
      for (const action of resourceActions) {
        try {
          const job = this.jobReader(action.externalJobId);
          if (!job.completed) jobPending = true;
          else {
            action.externalJobFinished = true;
            action.finishedAt = new Date().toISOString();
            action.effectState = job.passed ? "applied" : "failed";
            if (!job.passed) jobFailed = true;
            else action.jobInvocationId = job.invocationId;
          }
        } catch {
          jobPending = true;
        }
      }
    }
    const coveredActionIds = record.actions
      .filter((action) => {
        if (
          !latestTargetMatches ||
          !action.mutating ||
          !action.finishedAt ||
          action.effectState !== "applied" ||
          !sameResource(action.systemTarget)
        )
          return false;
        if (
          normalized.kind === "nixos-generation" &&
          (jobPending || jobFailed || !action.jobInvocationId)
        )
          return false;
        return (
          action.systemTarget.kind !== "user-service" ||
          action.systemTarget.operation !== "restart" ||
          (typeof action.beforeInvocationId === "string" &&
            typeof readback.observation.invocationId === "string" &&
            readback.observation.invocationId.length > 0 &&
            action.beforeInvocationId !== readback.observation.invocationId)
        );
      })
      .map((action) => action.actionId);
    const status = jobPending
      ? "pending"
      : !readback.passed || jobFailed
        ? "failed"
        : coveredActionIds.length === 0 || jobPending
          ? "pending"
          : "passed";
    if (status === "passed") {
      record.verification = record.verification.filter(
        (check) =>
          !(
            check.status === "pending" &&
            check.proofKind === "host-system-state" &&
            check.evidenceRef === readback.source
          ),
      );
    }
    return this.recordVerification(
      record,
      {
        checkId,
        status,
        summary:
          status === "pending"
            ? "System state observed, but matching completed action or apply-job evidence is missing"
            : status === "passed"
              ? "Host system readback matches the requested state"
              : "Host system readback differs from the requested state",
        source_of_truth: [readback.source],
        evidenceRef: readback.source,
      },
      READBACK_PROOF,
      { proofKind: "host-system-state", coveredActionIds },
    );
  }

  getEvents(record, afterRevision = 0) {
    const first = record.events[0]?.revision ?? record.revision;
    return {
      run: toPublicRunSnapshot(record),
      events: record.events.filter((entry) => entry.revision > afterRevision),
      currentRevision: record.revision,
      // Clients of protocol 1 can derive this from first revision as well.
      earliestAvailableRevision: first,
      historyTruncated:
        afterRevision < first - 1 || afterRevision > record.revision,
    };
  }

  settleTurn(record, { aborted = false } = {}) {
    const now = new Date().toISOString();
    const hasInflightMutatingAction = record.actions.some(
      (a) => a.mutating && !a.finishedAt,
    );
    const hasFailedAction = record.actions.some((a) => hasOpenFailure(a));
    const hasFailedVerification = record.verification.some(
      (v) => v.status === "failed",
    );
    const hasPassedVerification =
      record.verification.length > 0 &&
      record.verification.every(
        (v) => v.status === "passed" && HOST_PROOF_KINDS.has(v.proofKind),
      ) &&
      record.actions
        .filter(
          (a) => a.mutating && a.effectState !== "not_applied" && !a.resolution,
        )
        .every((a) =>
          record.verification.some(
            (v) =>
              v.status === "passed" && v.coveredActionIds?.includes(a.actionId),
          ),
        );

    if (aborted || record.state === "CANCELLING") {
      if (
        hasInflightMutatingAction ||
        record.actions.some((a) => a.externalJobId && !a.externalJobFinished)
      ) {
        for (const action of record.actions) {
          if (
            !action.finishedAt ||
            (action.externalJobId && !action.externalJobFinished)
          ) {
            action.finishedAt = now;
            action.effectState = "unknown";
          }
        }
        return this.transition(record, {
          state: "UNCERTAIN",
          stateReason: "EXTERNAL_EFFECT_UNCERTAIN_AFTER_ABORT",
          lastStep: "turn.aborted_with_inflight_action",
          result: {
            outcome: "uncertain",
            partial: true,
            message:
              "Agent turn aborted while a mutating tool action had no confirmed completion",
            cancelScope: "turn_aborted_external_effect_uncertain",
            verificationRefs: record.verification
              .filter((v) => v.status === "passed")
              .map((v) => v.checkId),
          },
          eventName: "run.reconcile_required",
        });
      }
      for (const action of record.actions) {
        if (!action.finishedAt) {
          action.finishedAt = now;
          action.effectState = "not_applied";
        }
      }
      return this.transition(record, {
        state: "CANCELLED",
        stateReason: "TURN_AND_TOOLS_STOPPED",
        lastStep: "turn.cancelled",
        result: {
          outcome: "cancelled",
          partial: record.actions.some((a) => a.effectState === "applied"),
          message: "Run cancelled and all tracked tool actions stopped",
          cancelScope: "turn_and_tools_stopped",
          verificationRefs: record.verification
            .filter((v) => v.status === "passed")
            .map((v) => v.checkId),
        },
        eventName: "run.settled",
      });
    }

    if (hasInflightMutatingAction) {
      return this.transition(record, {
        state: "UNCERTAIN",
        stateReason: "MUTATING_ACTION_COMPLETION_UNKNOWN",
        lastStep: "turn.settled_with_inflight_action",
        eventName: "run.reconcile_required",
      });
    }

    if (
      (hasFailedVerification || hasFailedAction || record.executionError) &&
      record.actions.some(
        (action) =>
          action.effectState === "unknown" ||
          (action.externalJob && !action.externalJobFinished),
      )
    )
      return this.finishWithoutProof(record);

    if (hasFailedVerification) {
      return this.transition(record, {
        state: "FAILED",
        stateReason: "VERIFICATION_FAILED",
        lastStep: "turn.settled_verification_failed",
        result: {
          outcome: "failed",
          partial: record.actions.some((a) => a.effectState === "applied"),
          errorCode: "TOOL_FAILED",
          message: "Run verification reported failure",
          verificationRefs: record.verification
            .filter((v) => v.status === "passed")
            .map((v) => v.checkId),
        },
        eventName: "run.settled",
      });
    }

    if (hasFailedAction || record.executionError) {
      return this.transition(record, {
        state: "FAILED",
        stateReason: record.executionError
          ? "AGENT_EXECUTION_FAILED"
          : "TOOL_EXECUTION_FAILED",
        lastStep: "turn.settled_with_tool_error",
        result: {
          outcome: "failed",
          partial: record.actions.some((a) => a.effectState === "applied"),
          errorCode: "TOOL_FAILED",
          message: record.executionError
            ? "Agent or provider failed during run execution"
            : "One or more tool calls failed during run execution",
          verificationRefs: [],
        },
        eventName: "run.settled",
      });
    }

    // A completed turn cannot produce an independent proof for opaque tools.
    // End the execution honestly, while retaining supported readback paths and
    // never treating absent evidence as success or an unknown effect as known.
    const unsupportedProof = record.actions.some(
      (action) =>
        action.mutating &&
        !action.resolution &&
        action.effectState === "applied" &&
        !action.targetPath &&
        !action.systemTarget,
    );
    if (
      unsupportedProof ||
      (record.requireVerification &&
        record.actions.length === 0 &&
        !hasPassedVerification)
    ) {
      return this.finishWithoutProof(record);
    }

    if (
      record.verification.some((v) => v.status === "pending") ||
      ((record.requireVerification || record.actions.some((a) => a.mutating)) &&
        !hasPassedVerification)
    ) {
      return this.transition(record, {
        state: "VERIFYING",
        stateReason: "AWAITING_VERIFICATION_EVIDENCE",
        lastStep: "turn.settled_awaiting_verification",
        eventName: "run.updated",
      });
    }

    return this.transition(record, {
      state: "SUCCEEDED",
      stateReason: hasPassedVerification
        ? "VERIFICATION_PASSED"
        : "COMPLETED_WITHOUT_ERRORS",
      lastStep: "turn.settled_succeeded",
      result: {
        outcome: "succeeded",
        partial: false,
        message: "Run completed",
        verificationRefs: record.verification
          .filter((v) => v.status === "passed")
          .map((v) => v.checkId),
      },
      eventName: "run.settled",
    });
  }

  finishWithoutProof(record) {
    const unknownEffect = record.actions.some(
      (action) =>
        action.effectState === "unknown" ||
        (action.externalJob && !action.externalJobFinished) ||
        (action.mutating && !action.finishedAt),
    );
    addUniqueBounded(
      record.remaining_issues,
      unknownEffect
        ? "External effect still requires reconciliation"
        : "Independent verification evidence is unavailable for the completed turn",
    );
    return this.transition(record, {
      state: unknownEffect ? "UNCERTAIN" : "BLOCKED",
      stateReason: unknownEffect
        ? "EXTERNAL_EFFECT_AWAITING_RECONCILIATION"
        : "VERIFICATION_UNAVAILABLE",
      lastStep: "turn.completed_without_proof",
      result: {
        outcome: unknownEffect ? "uncertain" : "blocked",
        partial: true,
        message: unknownEffect
          ? "Execution ended; external effect requires reconciliation"
          : "Execution ended; independent verification evidence is missing",
        verificationRefs: record.verification
          .filter((v) => v.status === "passed")
          .map((v) => v.checkId),
      },
      eventName: unknownEffect ? "run.reconcile_required" : "run.settled",
    });
  }

  reconcileRun(
    record,
    {
      effectState,
      notes,
      source_of_truth,
      observations,
      rollback,
      remaining_issues,
    },
  ) {
    applyOperatorReportFields(record, {
      source_of_truth,
      observations,
      rollback,
      remaining_issues,
    });
    if (record.state !== "UNCERTAIN" && record.state !== "RECONCILING") {
      const err = new Error(
        `Run ${record.runId} is in state ${record.state} and cannot be reconciled`,
      );
      err.code = "RUN_CONFLICT";
      throw err;
    }

    this.transition(record, {
      state: "RECONCILING",
      stateReason: "INSPECTING_SYSTEM_STATE",
      lastStep: "reconcile.started",
    });

    for (const action of record.actions) {
      if (action.effectState === "unknown") {
        action.effectState = effectState;
        if (typeof notes === "string" && notes) {
          action.reconcileNote = notes;
        }
      }
    }

    if (effectState === "unknown") {
      return this.transition(record, {
        state: "BLOCKED",
        stateReason: "UNKNOWN_EXTERNAL_EFFECT_NO_AUTO_RETRY",
        lastStep: "reconcile.blocked_unknown_effect",
        result: {
          outcome: "blocked",
          partial: true,
          errorCode: "RUN_CONFLICT",
          message:
            notes ||
            "External system effect remains unknown after inspection; automatic retry is forbidden",
          verificationRefs: [],
        },
        eventName: "run.settled",
      });
    }

    if (effectState === "not_applied") {
      return this.transition(record, {
        state: "RESUMABLE",
        stateReason: "RECONCILED_NOT_APPLIED",
        lastStep: "reconcile.resumable",
        result: null,
        eventName: "run.updated",
      });
    }

    // A caller's effect assertion or evidence label is not a measured goal check.
    return this.transition(record, {
      state: "VERIFYING",
      stateReason: "RECONCILED_APPLIED_AWAITING_VERIFICATION",
      lastStep: "reconcile.awaiting_verification",
      eventName: "run.updated",
    });
  }

  listRuns({ sessionId, limit = 50, before } = {}) {
    const all = [...this.runs.values()]
      .filter((r) => (sessionId ? r.sessionId === sessionId : true))
      .sort((a, b) => {
        if (a.createdAt !== b.createdAt) {
          return a.createdAt.localeCompare(b.createdAt);
        }
        return a.runId.localeCompare(b.runId);
      });

    let end = all.length;
    if (before !== undefined) {
      const match = /^r:(0|[1-9]\d*)$/.exec(before);
      if (!match || Number(match[1]) > all.length) {
        const err = new Error("Invalid run list cursor");
        err.code = "INVALID_REQUEST";
        throw err;
      }
      end = Number(match[1]);
    }
    const start = Math.max(0, end - limit);
    const page = all.slice(start, end).map(toPublicRunSummary);
    const corrupted = [...this.corruptedRuns.values()];

    return {
      runs: page,
      ...(start > 0 ? { nextCursor: `r:${start}` } : {}),
      ...(corrupted.length > 0 ? { corrupted } : {}),
    };
  }
}
