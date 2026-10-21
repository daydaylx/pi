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
]);

const MAX_RUN_EVENTS = 200;

function sanitizeTitle(raw, fallback = "Systemauftrag") {
  if (typeof raw !== "string") return fallback;
  const firstLine = raw
    .split(/\r?\n/)[0]
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
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

export function toPublicRunSnapshot(record) {
  const { pendingMessage, ...rest } = record;
  return structuredClone({
    schemaVersion: rest.schemaVersion,
    runId: rest.runId,
    sessionId: rest.sessionId,
    ...(typeof rest.clientSubmissionId === "string"
      ? { clientSubmissionId: rest.clientSubmissionId }
      : {}),
    title: rest.title,
    createdAt: rest.createdAt,
    updatedAt: rest.updatedAt,
    revision: rest.revision,
    hostEpoch: rest.hostEpoch,
    state: rest.state,
    stateReason: rest.stateReason,
    lastStep: rest.lastStep,
    queued: rest.queued === true,
    requireVerification: rest.requireVerification === true,
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
    verification: rest.verification.map((entry) => ({
      checkId: entry.checkId,
      status: entry.status,
      summary: entry.summary,
      recordedAt: entry.recordedAt,
      ...(typeof entry.evidenceRef === "string"
        ? { evidenceRef: entry.evidenceRef }
        : {}),
    })),
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
  constructor({ runsDir, hostEpoch }) {
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
    const record = {
      schemaVersion: 1,
      runId,
      sessionId,
      ...(typeof clientSubmissionId === "string" && clientSubmissionId.length > 0
        ? { clientSubmissionId }
        : {}),
      title: sanitizeTitle(title ?? message),
      createdAt: now,
      updatedAt: now,
      revision: 1,
      hostEpoch: this.hostEpoch,
      state: "ACCEPTED",
      stateReason: queued ? "QUEUED" : "SUBMITTED",
      lastStep: queued ? "queued" : "accepted",
      queued: queued === true,
      requireVerification: requireVerification === true,
       ...(queued || true ? { pendingMessage: message } : {}),
      actions: [],
      verification: [],
      result: null,
      events: [],
    };
    this.appendRunEvent(record, "run.created");
    return this.persist(record);
  }

  transition(record, { state, stateReason, lastStep, queued, result, eventName = "run.updated" }) {
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

  recordToolStarted(record, { toolCallId, toolName, externalJob = false }) {
    const now = new Date().toISOString();
    const mutating = MUTATING_TOOLS.has(toolName) || externalJob === true;
    const action = {
      actionId: `act_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
      toolCallId: String(toolCallId || `tc_${ record.actions.length + 1 }`),
      toolName: String(toolName || "unknown"),
      mutating,
      externalJob: externalJob === true,
      startedAt: now,
      effectState: "executing",
    };
    record.actions.push(action);
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

  recordToolFinished(record, { toolCallId, toolName, isError }) {
    const now = new Date().toISOString();
    const action =
      [...record.actions]
        .reverse()
        .find((a) => a.toolCallId === toolCallId && !a.finishedAt) ??
      [...record.actions].reverse().find((a) => !a.finishedAt);

    if (action) {
      action.finishedAt = now;
      action.effectState = isError
        ? "failed"
        : action.mutating
          ? "applied"
          : "not_applied";
    }
    record.updatedAt = now;
    record.revision += 1;
    record.lastStep = isError
      ? `tool.failed:${toolName || action?.toolName || "unknown"}`
      : `tool.completed:${toolName || action?.toolName || "unknown"}`;
    if (isError && record.state !== "CANCELLING") {
      record.stateReason = "TOOL_EXECUTION_ERROR";
    }
    this.appendRunEvent(record, "run.updated");
    return this.persist(record);
  }

  recordVerification(record, { checkId, status, summary, evidenceRef }) {
    const now = new Date().toISOString();
    const existingIdx = record.verification.findIndex(
      (v) => v.checkId === checkId,
    );
    const entry = {
      checkId,
      status,
      summary,
      recordedAt: now,
      ...(typeof evidenceRef === "string" && evidenceRef.length > 0
        ? { evidenceRef }
        : {}),
    };
    if (existingIdx >= 0) {
      record.verification[existingIdx] = entry;
    } else {
      record.verification.push(entry);
    }
    record.updatedAt = now;
    record.revision += 1;
    record.lastStep = `verification.${status}:${checkId}`;

    if (
      record.state === "VERIFYING" &&
      status === "passed" &&
      !record.verification.some((v) => v.status === "failed" || v.status === "pending")
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

  settleTurn(record, { aborted = false } = {}) {
    const now = new Date().toISOString();
    const hasInflightMutatingAction = record.actions.some(
      (a) => a.mutating && !a.finishedAt,
    );
    const hasFailedAction = record.actions.some(
      (a) => a.effectState === "failed",
    );
    const hasFailedVerification = record.verification.some(
      (v) => v.status === "failed",
    );
    const hasPassedVerification =
      record.verification.length > 0 &&
      record.verification.every((v) => v.status === "passed");

    if (aborted || record.state === "CANCELLING") {
      if (hasInflightMutatingAction) {
        for (const action of record.actions) {
          if (!action.finishedAt) {
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

    if (hasFailedAction && !hasPassedVerification) {
      return this.transition(record, {
        state: "FAILED",
        stateReason: "TOOL_EXECUTION_FAILED",
        lastStep: "turn.settled_with_tool_error",
        result: {
          outcome: "failed",
          partial: record.actions.some((a) => a.effectState === "applied"),
          errorCode: "TOOL_FAILED",
          message: "One or more tool calls failed during run execution",
          verificationRefs: [],
        },
        eventName: "run.settled",
      });
    }

    if (record.requireVerification && !hasPassedVerification) {
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

  reconcileRun(record, { effectState, notes, evidenceRef }) {
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

    // effectState === "applied"
    if (evidenceRef || !record.requireVerification) {
      if (evidenceRef) {
        record.verification.push({
          checkId: "reconcile-verification",
          status: "passed",
          summary: notes || "External effect verified as applied during reconcile",
          recordedAt: new Date().toISOString(),
          evidenceRef,
        });
      }
      return this.transition(record, {
        state: "SUCCEEDED",
        stateReason: "RECONCILED_APPLIED_AND_VERIFIED",
        lastStep: "reconcile.succeeded",
        result: {
          outcome: "succeeded",
          partial: false,
          message:
            notes || "Interrupted action was verified as already applied",
          verificationRefs: record.verification
            .filter((v) => v.status === "passed")
            .map((v) => v.checkId),
        },
        eventName: "run.settled",
      });
    }

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
