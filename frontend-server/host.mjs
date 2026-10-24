import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, lstatSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  CAPABILITIES,
  PROTOCOL_PACKAGE_VERSION,
  PROTOCOL_VERSION,
  isClientHello,
  isKnownRequestMethod,
  isRequest,
  isValidEventData,
  isValidRequestParams,
  isValidRequestResult,
  negotiateProtocolVersion,
  protocolError,
} from "../npm/packages/frontend-protocol/dist/index.js";
import {
  ACTIVE_EXECUTION_STATES,
  RunStore,
  TERMINAL_RUN_STATES,
  toPublicRunSnapshot,
} from "./runs.mjs";
import { releaseApplyJob } from "./state-readback.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_FRONTEND = path.join(ROOT, "bin", "pi-frontend");
const DEFAULT_RUNTIME = path.join(ROOT, "bin", "pi-system-runtime");
const MAX_CLIENTS = 8;
const MAX_INFLIGHT_PER_CLIENT = 32;
const MAX_INFLIGHT_TOTAL = 128;
const MAX_FRAME_CHARS = 256 * 1024;
const MAX_BACKEND_FRAME_CHARS = 8 * 1024 * 1024;
const MAX_CLIENT_BUFFERED_CHARS = 512 * 1024;
const MAX_CLIENT_WRITE_BUFFER = 1024 * 1024;
const PROMPT_START_GRACE_MS = 5_000;
const SESSION_BUSY_MUTATIONS = new Set([
  "session.create",
  "session.open",
  "session.rename",
  "session.archive",
  "session.delete",
  "model.set",
  "model.cycle",
  "thinking.set",
  "thinking.cycle",
  "permission.set",
  "command.invoke",
  "verification.run",
]);

const ALLOWED_ENV_EXACT = new Set([
  "HOME",
  "PATH",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "LANGUAGE",
  "TERM",
  "COLORTERM",
  "NO_COLOR",
  "FORCE_COLOR",
  "TZ",
  "TMPDIR",
  "TMP",
  "TEMP",
  "XDG_RUNTIME_DIR",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "XDG_STATE_HOME",
  "XDG_SESSION_TYPE",
  "DBUS_SESSION_BUS_ADDRESS",
  "WAYLAND_DISPLAY",
  "HYPRLAND_INSTANCE_SIGNATURE",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "no_proxy",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "NODE_EXTRA_CA_CERTS",
  "NIX_PATH",
  "NIX_SSL_CERT_FILE",
  "LOCALE_ARCHIVE",
]);

const FORBIDDEN_ENV_EXACT = new Set([
  "NODE_OPTIONS",
  "LD_PRELOAD",
  "LD_LIBRARY_PATH",
  "LD_AUDIT",
  "NODE_PATH",
  "BASH_ENV",
  "ENV",
  "PYTHONPATH",
]);

const PASSTHROUGH_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

function isForbiddenEnv(key) {
  return FORBIDDEN_ENV_EXACT.has(key) || key.startsWith("DYLD_");
}

export function filterBackendEnv(env = {}) {
  const result = {};
  if (!env || typeof env !== "object") return result;

  const passthroughNames = new Set();
  const rawPassthrough = env.PI_SYSTEM_HOST_ENV_PASSTHROUGH;
  if (typeof rawPassthrough === "string" && rawPassthrough.length > 0) {
    for (const item of rawPassthrough.split(",")) {
      const name = item.trim();
      if (
        name &&
        PASSTHROUGH_NAME_PATTERN.test(name) &&
        !isForbiddenEnv(name) &&
        passthroughNames.size < 64
      ) {
        passthroughNames.add(name);
      }
    }
  }

  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (isForbiddenEnv(key)) continue;
    if (
      ALLOWED_ENV_EXACT.has(key) ||
      key.startsWith("LC_") ||
      key.startsWith("PI_") ||
      passthroughNames.has(key)
    ) {
      result[key] = value;
    }
  }

  return result;
}

function line(stream, frame) {
  stream.write(`${JSON.stringify(frame)}\n`);
}

function attachLines(
  stream,
  onFrame,
  onInvalid,
  maxChars = MAX_FRAME_CHARS,
  onTooLarge = onInvalid,
) {
  stream.setEncoding("utf8");
  let buffer = "";
  let discarding = false;
  stream.on("data", (chunk) => {
    if (discarding) {
      const newline = chunk.indexOf("\n");
      if (newline < 0) return;
      chunk = chunk.slice(newline + 1);
      discarding = false;
    }
    buffer += chunk;
    while (true) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) {
        if (buffer.length > maxChars) {
          buffer = "";
          discarding = true;
          onTooLarge("frame too large");
        }
        break;
      }
      const raw = buffer.slice(0, newline).replace(/\r$/, "");
      buffer = buffer.slice(newline + 1);
      if (raw.length > maxChars) {
        onTooLarge("frame too large");
        continue;
      }
      if (!raw.trim()) continue;
      try {
        onFrame(JSON.parse(raw));
      } catch {
        onInvalid("invalid JSON");
      }
    }
  });
  stream.on("end", () => {
    if (discarding) return;
    if (!buffer.trim()) return;
    if (buffer.length > maxChars) onInvalid("frame too large");
    else {
      try {
        onFrame(JSON.parse(buffer.replace(/\r$/, "")));
      } catch {
        onInvalid("invalid JSON");
      }
    }
  });
}

function makeError(code, message, retryable = false) {
  return protocolError(code, message, randomUUID(), { retryable });
}

function isDirectoryOwnedByUser(directory, { create = false } = {}) {
  if (create) mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stats = lstatSync(directory);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error("System host paths must be real directories");
  }
  if (typeof process.getuid === "function" && stats.uid !== process.getuid()) {
    throw new Error("System host directory is owned by another user");
  }
  if ((stats.mode & 0o077) !== 0) chmodSync(directory, 0o700);
  return realpathSync(directory);
}

function ensureProfileDirectories(agentDir) {
  if (!path.isAbsolute(agentDir)) {
    throw new Error("PI_CODING_AGENT_DIR must be an absolute path");
  }
  const agentStats = lstatSync(agentDir);
  if (agentStats.isSymbolicLink() || !agentStats.isDirectory()) {
    throw new Error("Pi agent directory must be a real directory");
  }
  if (
    typeof process.getuid === "function" &&
    agentStats.uid !== process.getuid()
  ) {
    throw new Error("Pi agent directory is owned by another user");
  }
  const canonicalAgentDir = realpathSync(agentDir);
  const root = path.join(canonicalAgentDir, "profile-state");
  const system = path.join(root, "system");
  const workspace = path.join(system, "workspace");
  const sessions = path.join(system, "host-sessions");
  const runs = path.join(system, "runs");
  for (const directory of [root, system, workspace, sessions, runs]) {
    try {
      const stats = lstatSync(directory);
      if (stats.isSymbolicLink() || !stats.isDirectory()) {
        throw new Error("System profile paths cannot be symlinks");
      }
      if (
        typeof process.getuid === "function" &&
        stats.uid !== process.getuid()
      ) {
        throw new Error("System profile path is owned by another user");
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      mkdirSync(directory, { mode: 0o700 });
    }
    const stats = lstatSync(directory);
    if ((stats.mode & 0o077) !== 0) chmodSync(directory, 0o700);
  }
  return { agentDir: canonicalAgentDir, workspace, sessions, runs };
}

async function removeStaleSocket(socketPath) {
  let stats;
  try {
    stats = lstatSync(socketPath);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  if (!stats.isSocket()) throw new Error("Host socket path is not a socket");
  if (typeof process.getuid === "function" && stats.uid !== process.getuid()) {
    throw new Error("Host socket belongs to another user");
  }
  const active = await new Promise((resolve, reject) => {
    const probe = net.createConnection(socketPath);
    probe.once("connect", () => {
      probe.destroy();
      resolve(true);
    });
    probe.once("error", (error) => {
      if (error?.code === "ECONNREFUSED") resolve(false);
      else reject(error);
    });
  });
  if (active) throw new Error("A Pi System host is already listening");
  rmSync(socketPath);
}

function mergePatch(current, patch) {
  const next = { ...current };
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      current[key] &&
      typeof current[key] === "object" &&
      !Array.isArray(current[key])
    ) {
      next[key] = { ...current[key], ...value };
    } else next[key] = value;
  }
  return next;
}

export class PiSystemHost {
  constructor({
    env = process.env,
    runtimeDir = env.PI_SYSTEM_HOST_RUNTIME_DIR ?? env.XDG_RUNTIME_DIR,
    socketPath,
    frontendPath = DEFAULT_FRONTEND,
    runtimePath = DEFAULT_RUNTIME,
    promptStartGraceMs = PROMPT_START_GRACE_MS,
    startupTimeoutMs = 10_000,
    verificationTimeoutMs = 30_000,
    requestTimeoutMs,
    approvalTtlMs,
    maxBackendFrameChars = MAX_BACKEND_FRAME_CHARS,
  } = {}) {
    if (!runtimeDir || !path.isAbsolute(runtimeDir)) {
      throw new Error("XDG_RUNTIME_DIR must be an absolute path");
    }
    const runtimeRoot = isDirectoryOwnedByUser(runtimeDir);
    const hostDir = path.join(runtimeRoot, "pi-system-host");
    try {
      isDirectoryOwnedByUser(hostDir);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      mkdirSync(hostDir, { mode: 0o700 });
      isDirectoryOwnedByUser(hostDir);
    }
    this.socketPath = socketPath ?? path.join(hostDir, "frontend.sock");
    if (path.dirname(this.socketPath) !== hostDir) {
      throw new Error(
        "Host socket must stay inside its private runtime directory",
      );
    }

    const defaultAgentDir = path.join(env.HOME ?? os.homedir(), ".pi", "agent");
    const profile = ensureProfileDirectories(
      env.PI_CODING_AGENT_DIR ?? defaultAgentDir,
    );
    this.profile = profile;
    this.env = {
      ...filterBackendEnv(env),
      PI_CODING_AGENT_DIR: profile.agentDir,
      PI_CODING_AGENT_SESSION_DIR: profile.sessions,
      PI_SYSTEM_WORKSPACE: profile.workspace,
      PI_SYSTEM_SESSION_DIR: profile.sessions,
      PI_LAUNCH_PROFILE: "system",
      PI_FRONTEND_PI_PATH: runtimePath,
    };
    this.frontendPath = frontendPath;
    this.promptStartGraceMs = promptStartGraceMs;
    this.verificationTimeoutMs = verificationTimeoutMs;
    this.startupTimeoutMs = startupTimeoutMs;
    this.maxBackendFrameChars = maxBackendFrameChars;
    const configuredTimeout = Number(
      requestTimeoutMs ?? env.PI_SYSTEM_HOST_REQUEST_TIMEOUT_MS ?? 60_000,
    );
    this.requestTimeoutMs = Math.min(
      600_000,
      Math.max(
        1_000,
        Number.isFinite(configuredTimeout) ? configuredTimeout : 60_000,
      ),
    );
    const configuredTtl = Number(
      approvalTtlMs ?? env.PI_SYSTEM_APPROVAL_TTL_MS ?? 120_000,
    );
    this.approvalTtlMs = Math.min(
      600_000,
      Math.max(5_000, Number.isFinite(configuredTtl) ? configuredTtl : 120_000),
    );
    this.server = undefined;
    this.socketIdentity = undefined;
    this.backend = undefined;
    this.backendHello = undefined;
    this.ready = undefined;
    this.readyResolve = undefined;
    this.readyReject = undefined;
    this.sequence = 0;
    this.nextClientId = 1;
    this.clients = new Map();
    this.pending = new Map();
    this.pendingUi = new Map();
    this.hostEpoch = undefined;
    this.runStore = undefined;
    this.currentRunId = undefined;
    this.state = undefined;
    this.activeRun = false;
    this.uncertainRun = false;
    this.promptReserved = false;
    this.promptReservationTimer = undefined;
    this.stopping = false;
  }

  async start() {
    this.hostEpoch = randomUUID();
    this.runStore = new RunStore({
      runsDir: this.profile.runs,
      hostEpoch: this.hostEpoch,
    });
    const reconciledOnStartup = this.runStore.loadAndReconcileStartup(
      this.hostEpoch,
    );
    if (
      reconciledOnStartup.length > 0 ||
      this.runStore.getActiveOrBlockingRun()?.state === "UNCERTAIN"
    ) {
      this.uncertainRun = true;
    }
    await removeStaleSocket(this.socketPath);
    this.ready = new Promise((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    this.backend = spawn(this.frontendPath, [], {
      cwd: this.profile.workspace,
      env: this.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.backend.once("error", (error) => {
      this.readyReject?.(error);
      if (!this.stopping) void this.stop(1);
    });
    this.backend.once("exit", () => {
      if (!this.stopping) void this.stop(1);
    });
    this.backend.stderr.setEncoding("utf8");
    this.backend.stderr.on("data", () => {});
    attachLines(
      this.backend.stdout,
      (frame) => this.handleBackendFrame(frame),
      () => {
        if (this.readyReject) {
          this.readyReject(new Error("Pi frontend emitted invalid JSONL"));
        } else {
          void this.stop(1);
        }
      },
      this.maxBackendFrameChars,
      () => this.handleBackendFrameTooLarge(),
    );
    line(this.backend.stdin, {
      kind: "hello",
      client: { name: "pi-system-host", version: PROTOCOL_PACKAGE_VERSION },
      supportedProtocolVersions: [PROTOCOL_VERSION],
    });

    let timer;
    try {
      await Promise.race([
        this.ready,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Pi frontend startup timed out")),
            this.startupTimeoutMs,
          );
        }),
      ]);
    } catch (error) {
      await this.stop(1);
      throw error;
    } finally {
      clearTimeout(timer);
    }

    this.server = net.createServer((socket) => this.acceptClient(socket));
    await new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.socketPath, resolve);
    });
    chmodSync(this.socketPath, 0o600);
    const socketStats = lstatSync(this.socketPath);
    if (!socketStats.isSocket()) {
      throw new Error("Host did not create a Unix socket");
    }
    this.socketIdentity = {
      dev: socketStats.dev,
      ino: socketStats.ino,
      uid: socketStats.uid,
    };
    return this;
  }

  handleBackendFrameTooLarge() {
    const error = makeError(
      "RESULT_TOO_LARGE",
      "Pi frontend response exceeded the 8 MiB backend frame limit",
    );
    for (const request of this.pending.values()) {
      if (request.timer) clearTimeout(request.timer);
      if (request.internalUi) {
        continue;
      }
      request.client.inflight.delete(request.clientId);
      if (!request.client.socket.destroyed) {
        line(request.client.socket, {
          protocolVersion: PROTOCOL_VERSION,
          kind: "response",
          id: request.clientId,
          ok: false,
          error,
        });
      }
    }
    this.pending.clear();
    for (const client of this.clients.values()) {
      if (client.ready) this.sendClientEvent(client, "error", { error });
    }
  }

  handleBackendFrame(frame) {
    if (frame?.kind === "hello") {
      if (!frame.accepted) {
        this.readyReject?.(
          new Error(frame.error?.message ?? "Pi frontend handshake failed"),
        );
        return;
      }
      this.backendHello = frame;
      this.resolveReadyIfComplete();
      return;
    }
    if (frame?.kind === "response") {
      const request = this.pending.get(frame.id);
      if (!request) return;
      if (request.timer) clearTimeout(request.timer);
      this.pending.delete(frame.id);
      if (request.internalUi || request.internalRun) {
        if (request.internalRun && request.runId) {
          this.handleInternalRunBackendResponse(request, frame);
        }
        return;
      }
      request.client.inflight.delete(request.clientId);
      const startsTurn =
        request.method === "agent.prompt" ||
        request.method === "agent.followUp";
      if (startsTurn) {
        if (!frame.ok && frame.error?.code !== "REQUEST_TIMEOUT") {
          this.clearPromptReservation();
        } else if (frame.error?.code === "REQUEST_TIMEOUT") {
          this.activeRun = true;
          this.uncertainRun = true;
          this.clearPromptReservation();
        } else if (!this.activeRun) {
          this.schedulePromptReservationRelease();
        }
      }
      if (request.method === "session.current" && frame.ok) {
        const hasUncertainRunRecord =
          this.runStore?.getActiveOrBlockingRun()?.state === "UNCERTAIN";
        if (
          frame.result?.isStreaming === false &&
          this.pendingUi.size === 0 &&
          !hasUncertainRunRecord
        ) {
          this.activeRun = false;
          this.uncertainRun = false;
          this.clearPromptReservation();
        } else if (frame.result?.isStreaming === true) {
          this.activeRun = true;
          if (!hasUncertainRunRecord) this.uncertainRun = false;
          this.clearPromptReservation();
        }
      }
      if (request.method === "ui.respond" && frame.ok) {
        this.finishUi(request.uiId, "answered", false);
      } else if (request.method === "ui.respond") {
        const pendingUi = this.pendingUi.get(request.uiId);
        if (pendingUi) pendingUi.responding = false;
      }
      if (!request.client.socket.destroyed) {
        const response = {
          protocolVersion: PROTOCOL_VERSION,
          kind: "response",
          id: request.clientId,
          ok: frame.ok === true,
          ...(frame.ok === true
            ? { result: frame.result }
            : { error: frame.error }),
        };
        line(request.client.socket, response);
      }
      return;
    }
    if (frame?.kind !== "event") return;
    let eventData = frame.data;
    if (frame.event === "state.snapshot") {
      const previousSessionId = this.state?.session?.id;
      this.state = frame.data;
      if (
        this.pendingUi.size > 0 &&
        previousSessionId !== this.state?.session?.id
      ) {
        this.cancelPendingUi();
      }
      this.updateRunState();
      this.resolveReadyIfComplete();
    } else if (frame.event === "state.patch") {
      const previousSessionId = this.state?.session?.id;
      this.state = mergePatch(this.state ?? {}, frame.data);
      if (
        this.pendingUi.size > 0 &&
        previousSessionId !== this.state?.session?.id
      ) {
        this.cancelPendingUi();
      }
      this.updateRunState();
    } else if (frame.event === "session.changed") {
      this.cancelPendingUi();
    } else if (frame.event === "extension-ui.requested") {
      const id = frame.data?.id;
      if (typeof id === "string")
        eventData = this.trackUiRequest(id, frame.data);
    }
    for (const client of this.clients.values()) {
      if (!client.ready) continue;
      this.sendClientEvent(client, frame.event, eventData, frame.sessionId);
    }
    this.handleRunLifecycleEvent(frame.event, eventData);
  }

  trackUiRequest(id, data) {
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + this.approvalTtlMs);
    const digest = createHash("sha256")
      .update(
        JSON.stringify([
          data.method,
          data.title ?? "",
          data.message ?? "",
          data.options ?? [],
        ]),
      )
      .digest("hex");
    const enriched = {
      ...data,
      approval: {
        digest,
        sessionId: String(this.state?.session?.id ?? ""),
        createdAt: createdAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
      },
    };
    const timer = setTimeout(() => {
      if (!this.pendingUi.has(id)) return;
      this.finishUi(id, "expired", true);
    }, this.approvalTtlMs);
    timer.unref?.();
    this.pendingUi.set(id, { data: enriched, timer, responding: false });
    this.updateRunState();
    return enriched;
  }

  finishUi(id, outcome, notifyBackend) {
    const pending = this.pendingUi.get(id);
    if (!pending) return false;
    clearTimeout(pending.timer);
    this.pendingUi.delete(id);
    this.emitUiResolved(id, outcome);
    if (notifyBackend && this.backend?.stdin?.writable) {
      const backendId = `host-${randomUUID()}`;
      this.pending.set(backendId, {
        internalUi: true,
        uiId: id,
        outcome,
      });
      line(this.backend.stdin, {
        protocolVersion: PROTOCOL_VERSION,
        kind: "request",
        id: backendId,
        method: "ui.respond",
        params: { id, cancelled: true },
      });
    }
    this.updateRunState();
    const record = this.getCurrentOrBlockingRun();
    if (record && record.state === "WAITING_INPUT") {
      if (outcome === "answered") {
        const nextState = record.actions.some((a) => a.mutating)
          ? "EXECUTING"
          : "INVESTIGATING";
        this.runStore.transition(record, {
          state: nextState,
          stateReason: "USER_INPUT_RECEIVED",
          lastStep: `ui.answered:${id}`,
          eventName: "run.updated",
        });
        this.broadcastRunEvent("run.updated", record);
      } else if (outcome === "expired") {
        this.runStore.transition(record, {
          state: "BLOCKED",
          stateReason: "APPROVAL_EXPIRED",
          lastStep: `ui.expired:${id}`,
          result: {
            outcome: "blocked",
            partial: record.actions.some((a) => a.effectState === "applied"),
            errorCode: "PERMISSION_DENIED",
            message: "Required user confirmation expired before response",
            verificationRefs: [],
          },
          eventName: "run.settled",
        });
        if (this.currentRunId === record.runId) {
          this.currentRunId = undefined;
        }
        this.broadcastRunEvent("run.settled", record);
      }
    }
    return true;
  }

  emitUiResolved(id, outcome) {
    for (const client of this.clients.values()) {
      if (client.ready) {
        this.sendClientEvent(client, "extension-ui.resolved", { id, outcome });
      }
    }
  }

  cancelPendingUi() {
    for (const id of this.pendingUi.keys())
      this.finishUi(id, "cancelled", true);
  }

  resolveReadyIfComplete() {
    if (!this.backendHello || !this.state) return;
    const resolve = this.readyResolve;
    this.readyResolve = undefined;
    this.readyReject = undefined;
    resolve?.();
  }

  updateRunState() {
    const active =
      this.state?.activity?.kind === "responding" ||
      Boolean(this.state?.permissions?.pending) ||
      this.pendingUi.size > 0;
    this.activeRun = active;
    const hasUncertainRunRecord =
      this.runStore?.getActiveOrBlockingRun()?.state === "UNCERTAIN";
    if (hasUncertainRunRecord) {
      this.uncertainRun = true;
    } else if (active) {
      this.uncertainRun = false;
      this.clearPromptReservation();
    } else if (!this.uncertainRun && !this.promptReserved) {
      this.clearPromptReservation();
    }
  }

  schedulePromptReservationRelease() {
    this.clearPromptReservation();
    this.promptReserved = true;
    this.promptReservationTimer = setTimeout(() => {
      this.promptReserved = false;
      this.promptReservationTimer = undefined;
      this.maybeStartNextQueuedRun();
    }, this.promptStartGraceMs);
    this.promptReservationTimer.unref?.();
  }

  clearPromptReservation() {
    this.promptReserved = false;
    if (this.promptReservationTimer) {
      clearTimeout(this.promptReservationTimer);
      this.promptReservationTimer = undefined;
    }
  }

  scheduleVerificationDeadline(record) {
    clearTimeout(this.verificationTimer);
    this.verificationTimer = setTimeout(() => {
      this.verificationTimer = undefined;
      if (this.stopping || record.state !== "VERIFYING") return;
      this.runStore.finishWithoutProof(record);
      if (record.state === "UNCERTAIN") {
        this.uncertainRun = true;
        this.broadcastRunEvent("run.reconcile_required", record);
      } else {
        if (this.currentRunId === record.runId) this.currentRunId = undefined;
        this.broadcastRunEvent("run.settled", record);
      }
    }, this.verificationTimeoutMs);
    this.verificationTimer.unref?.();
  }

  acceptClient(socket) {
    if (this.stopping || this.clients.size >= MAX_CLIENTS) {
      socket.destroy();
      return;
    }
    const client = {
      id: this.nextClientId++,
      socket,
      ready: false,
      sequence: 0,
      buffer: "",
      inflight: new Set(),
    };
    this.clients.set(client.id, client);
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => this.handleClientData(client, chunk));
    socket.once("error", () => this.removeClient(client));
    socket.once("close", () => this.removeClient(client));
  }

  removeClient(client) {
    this.clients.delete(client.id);
  }

  handleClientData(client, chunk) {
    client.buffer += chunk;
    if (
      client.buffer.length > MAX_CLIENT_BUFFERED_CHARS &&
      !client.buffer.includes("\n")
    ) {
      client.socket.destroy();
      return;
    }
    while (true) {
      const newline = client.buffer.indexOf("\n");
      if (newline < 0) return;
      const raw = client.buffer.slice(0, newline).replace(/\r$/, "");
      client.buffer = client.buffer.slice(newline + 1);
      if (!raw.trim()) continue;
      if (raw.length > MAX_FRAME_CHARS) {
        this.sendClientError(
          client,
          undefined,
          "INVALID_REQUEST",
          "Request frame is too large",
        );
        client.socket.destroy();
        return;
      }
      let frame;
      try {
        frame = JSON.parse(raw);
      } catch {
        this.sendClientError(
          client,
          undefined,
          "INVALID_REQUEST",
          "Invalid JSONL request",
        );
        client.socket.destroy();
        return;
      }
      if (!client.ready) this.handleClientHello(client, frame);
      else this.handleClientRequest(client, frame);
    }
  }

  handleClientHello(client, frame) {
    if (!isClientHello(frame)) {
      line(client.socket, {
        kind: "hello",
        accepted: false,
        error: makeError("INVALID_REQUEST", "A valid hello frame is required"),
      });
      client.socket.end();
      return;
    }
    const negotiated = negotiateProtocolVersion(
      frame.supportedProtocolVersions,
    );
    if (!negotiated) {
      line(client.socket, {
        kind: "hello",
        accepted: false,
        error: makeError(
          "PROTOCOL_MISMATCH",
          "GUI and Pi protocol versions are incompatible",
        ),
      });
      client.socket.end();
      return;
    }
    client.ready = true;
    line(client.socket, {
      kind: "hello",
      accepted: true,
      protocolVersion: negotiated,
      serverVersion: PROTOCOL_PACKAGE_VERSION,
      piVersion: this.backendHello.piVersion,
      capabilities: [...CAPABILITIES, "shared-session-owner", "goal-readback"],
      hostEpoch: this.hostEpoch,
    });
    this.sendClientEvent(client, "state.snapshot", this.state);
    for (const pending of this.pendingUi.values()) {
      this.sendClientEvent(client, "extension-ui.requested", pending.data);
    }
    const activeRun = this.getCurrentOrBlockingRun();
    if (activeRun) {
      const eventName =
        activeRun.state === "UNCERTAIN"
          ? "run.reconcile_required"
          : "run.updated";
      this.sendClientEvent(
        client,
        eventName,
        { run: toPublicRunSnapshot(activeRun) },
        activeRun.sessionId,
      );
    }
  }

  getCurrentOrBlockingRun() {
    if (!this.runStore) return null;
    if (this.currentRunId) {
      try {
        const cur = this.runStore.getRun(this.currentRunId);
        if (cur && !TERMINAL_RUN_STATES.has(cur.state)) return cur;
      } catch {
        // Ignore corrupt lookup here
      }
    }
    return this.runStore.getActiveOrBlockingRun();
  }

  broadcastRunEvent(eventName, record, extra = {}) {
    if (TERMINAL_RUN_STATES.has(record.state)) {
      for (const action of record.actions) {
        if (
          action.externalJobId &&
          action.jobInvocationId &&
          !action.jobReleased &&
          releaseApplyJob(action.externalJobId, action.jobInvocationId)
        ) {
          action.jobReleased = true;
          this.runStore.persist(record);
        }
      }
    }
    if (!record) return;
    const payload = {
      run: toPublicRunSnapshot(record),
      ...extra,
    };
    for (const client of this.clients.values()) {
      if (!client.ready) continue;
      this.sendClientEvent(client, eventName, payload, record.sessionId);
    }
  }

  sendClientResult(client, id, method, result) {
    if (!isValidRequestResult(method, result)) {
      this.sendClientError(
        client,
        id,
        "INTERNAL_ERROR",
        `Invalid host result for ${method}`,
      );
      return;
    }
    if (!client.socket.destroyed) {
      line(client.socket, {
        protocolVersion: PROTOCOL_VERSION,
        kind: "response",
        id,
        ok: true,
        result,
      });
    }
  }

  dispatchRunBackendPrompt(record, messageText) {
    if (!this.backend?.stdin?.writable) {
      this.runStore.transition(record, {
        state: "FAILED",
        stateReason: "BACKEND_DISCONNECTED_BEFORE_START",
        lastStep: "prompt.dispatch_failed",
        result: {
          outcome: "failed",
          partial: false,
          errorCode: "RPC_DISCONNECTED",
          message: "Pi frontend is disconnected",
          verificationRefs: [],
        },
        eventName: "run.settled",
      });
      this.currentRunId = undefined;
      this.broadcastRunEvent("run.settled", record);
      return false;
    }

    this.currentRunId = record.runId;
    this.promptReserved = true;
    this.runStore.transition(record, {
      state: "INVESTIGATING",
      stateReason: "TURN_STARTING",
      lastStep: "prompt.dispatched",
      queued: false,
      eventName: "run.updated",
    });
    this.broadcastRunEvent("run.updated", record);

    const backendId = `host-run-${randomUUID()}`;
    const timer = setTimeout(() => {
      this.handleRequestTimeout(backendId);
    }, this.requestTimeoutMs);
    timer.unref?.();
    this.pending.set(backendId, {
      internalRun: true,
      runId: record.runId,
      method: "agent.prompt",
      timer,
    });

    try {
      line(this.backend.stdin, {
        protocolVersion: PROTOCOL_VERSION,
        kind: "request",
        id: backendId,
        method: "agent.prompt",
        params: { message: messageText },
      });
      return true;
    } catch {
      clearTimeout(timer);
      this.pending.delete(backendId);
      this.clearPromptReservation();
      this.runStore.transition(record, {
        state: "FAILED",
        stateReason: "BACKEND_WRITE_FAILED",
        lastStep: "prompt.write_failed",
        result: {
          outcome: "failed",
          partial: false,
          errorCode: "RPC_DISCONNECTED",
          message: "Failed to write prompt to Pi backend",
          verificationRefs: [],
        },
        eventName: "run.settled",
      });
      this.currentRunId = undefined;
      this.broadcastRunEvent("run.settled", record);
      return false;
    }
  }

  handleInternalRunBackendResponse(request, frame) {
    const record = this.runStore?.runs.get(request.runId);
    if (!record) return;
    if (request.method === "agent.prompt") {
      if (!frame.ok) {
        this.clearPromptReservation();
        if (frame.error?.code === "REQUEST_TIMEOUT") {
          this.activeRun = true;
          this.uncertainRun = true;
          this.runStore.transition(record, {
            state: "UNCERTAIN",
            stateReason: "PROMPT_REQUEST_TIMEOUT",
            lastStep: "prompt.timeout",
            result: {
              outcome: "uncertain",
              partial: record.actions.some((a) => a.effectState === "applied"),
              errorCode: "REQUEST_TIMEOUT",
              message:
                "Backend prompt request timed out; inspect state before retrying",
              verificationRefs: [],
            },
            eventName: "run.reconcile_required",
          });
          this.broadcastRunEvent("run.reconcile_required", record);
        } else {
          this.runStore.transition(record, {
            state: "FAILED",
            stateReason: "PROMPT_REJECTED_BY_BACKEND",
            lastStep: "prompt.rejected",
            result: {
              outcome: "failed",
              partial: false,
              errorCode: frame.error?.code ?? "INTERNAL_ERROR",
              message:
                frame.error?.message ?? "Backend rejected run prompt request",
              verificationRefs: [],
            },
            eventName: "run.settled",
          });
          if (this.currentRunId === record.runId) {
            this.currentRunId = undefined;
          }
          this.broadcastRunEvent("run.settled", record);
          this.maybeStartNextQueuedRun();
        }
      } else if (!this.activeRun) {
        this.schedulePromptReservationRelease();
      }
    }
  }

  handleRunLifecycleEvent(event, data) {
    if (!this.runStore) return;
    const record = this.getCurrentOrBlockingRun();
    if (!record || TERMINAL_RUN_STATES.has(record.state)) return;

    if (event === "error") {
      // Do not persist provider messages, which can contain request secrets.
      record.executionError = true;
      this.runStore.transition(record, {
        stateReason: "AGENT_EXECUTION_FAILED",
        lastStep: "agent.error_observed",
      });
      this.broadcastRunEvent("run.updated", record);
      return;
    }

    if (event === "tool.started") {
      this.runStore.recordToolStarted(record, {
        toolCallId: data?.toolCallId,
        toolName: data?.toolName,
        args:
          typeof data?.targetPath === "string" &&
          (path.isAbsolute(data.targetPath) || this.state?.session?.cwd)
            ? {
                path: path.resolve(
                  this.state?.session?.cwd ?? "/",
                  data.targetPath,
                ),
              }
            : data?.toolName === "system_job"
              ? { action: data?.jobAction }
              : undefined,
        systemTarget: data?.systemTarget,
      });
      this.broadcastRunEvent("run.updated", record);
      return;
    }

    if (event === "tool.completed" || event === "tool.failed") {
      this.runStore.recordToolFinished(record, {
        toolCallId: data?.toolCallId,
        toolName: data?.toolName,
        isError: event === "tool.failed" || data?.isError === true,
        externalJobId: data?.jobId,
      });
      if (
        data?.toolName === "system_state_verify" &&
        event === "tool.completed" &&
        data?.stateGoalCheck &&
        data?.isError !== true
      ) {
        try {
          this.runStore.verifySystemReadback(record, {
            goal: data.stateGoalCheck,
            checkId: `state-readback:${data.toolCallId}`,
          });
        } catch {
          this.runStore.recordVerification(record, {
            checkId: `state-readback:${data.toolCallId}`,
            status: "failed",
            summary:
              "Host could not independently read back the requested system goal",
          });
        }
      }
      if (
        data?.toolName === "system_file_verify" &&
        event === "tool.completed" &&
        data?.goalCheck &&
        data?.isError !== true
      ) {
        try {
          this.runStore.verifyFileReadback(record, {
            ...data.goalCheck,
            checkId: `file-readback:${data.toolCallId}`,
          });
        } catch {
          this.runStore.recordVerification(record, {
            checkId: `file-readback:${data.toolCallId}`,
            status: "failed",
            summary:
              "Host could not independently read back the requested file goal",
          });
        }
      }
      this.broadcastRunEvent("run.updated", record);
      return;
    }

    if (event === "extension-ui.requested" && typeof data?.id === "string") {
      if (record.state !== "CANCELLING") {
        this.runStore.transition(record, {
          state: "WAITING_INPUT",
          stateReason: "AWAITING_USER_INPUT",
          lastStep: `ui.requested:${data.id}`,
          eventName: "run.input_required",
        });
        this.broadcastRunEvent("run.input_required", record, {
          uiRequestId: data.id,
        });
      }
      return;
    }

    // Project-check status is not an independent system-goal observation.
    if (event === "verification.changed") return;

    if (event === "agent.settled") {
      this.runStore.settleTurn(record, { aborted: data?.aborted === true });
      if (record.state === "VERIFYING")
        this.scheduleVerificationDeadline(record);
      if (record.state === "UNCERTAIN") {
        this.uncertainRun = true;
        this.broadcastRunEvent("run.reconcile_required", record);
      } else if (TERMINAL_RUN_STATES.has(record.state)) {
        if (this.currentRunId === record.runId) {
          this.currentRunId = undefined;
        }
        this.broadcastRunEvent("run.settled", record);
        if (record.state === "SUCCEEDED") {
          this.maybeStartNextQueuedRun();
        }
      } else {
        this.broadcastRunEvent("run.updated", record);
      }
      return;
    }

    if (event === "core.disconnected") {
      const now = new Date().toISOString();
      for (const action of record.actions) {
        if (!action.finishedAt) {
          action.finishedAt = now;
          action.effectState = "unknown";
        }
      }
      this.uncertainRun = true;
      this.runStore.transition(record, {
        state: "UNCERTAIN",
        stateReason: "BACKEND_DISCONNECTED",
        lastStep: "core.disconnected",
        result: {
          outcome: "uncertain",
          partial: record.actions.some((a) => a.effectState === "applied"),
          errorCode: "PI_CRASHED",
          message:
            "Backend process disconnected while run was active; state inspection required",
          verificationRefs: [],
        },
        eventName: "run.reconcile_required",
      });
      this.broadcastRunEvent("run.reconcile_required", record);
    }
  }

  maybeStartNextQueuedRun() {
    if (!this.runStore || this.isBusy()) return;
    const nextQueued = this.runStore.getNextQueuedRun();
    if (!nextQueued) return;
    const msg = nextQueued.pendingMessage ?? nextQueued.title;
    this.dispatchRunBackendPrompt(nextQueued, msg);
  }

  handleRunClientRequest(client, frame) {
    const { id, method, params } = frame;
    const sessionId = String(this.state?.session?.id ?? "default-session");

    try {
      if (method === "run.current") {
        const active = this.getCurrentOrBlockingRun();
        this.sendClientResult(client, id, method, {
          run: active ? toPublicRunSnapshot(active) : null,
        });
        return;
      }

      if (method === "run.get") {
        let record;
        if (params.runId) {
          record = this.runStore.getRun(params.runId);
        } else if (params.clientSubmissionId) {
          record = this.runStore.findBySubmissionId(
            sessionId,
            params.clientSubmissionId,
          );
        }
        if (!record) {
          this.sendClientError(
            client,
            id,
            "RUN_NOT_FOUND",
            "Requested run was not found",
          );
          return;
        }
        this.sendClientResult(client, id, method, {
          run: toPublicRunSnapshot(record),
        });
        return;
      }

      if (method === "run.list") {
        const result = this.runStore.listRuns(params);
        this.sendClientResult(client, id, method, result);
        return;
      }

      if (method === "run.events") {
        const record = this.runStore.getRun(params.runId);
        if (!record) {
          this.sendClientError(
            client,
            id,
            "RUN_NOT_FOUND",
            `Run ${params.runId} not found`,
          );
          return;
        }
        this.sendClientResult(
          client,
          id,
          method,
          this.runStore.getEvents(record, params.afterRevision ?? 0),
        );
        return;
      }

      if (method === "run.submit") {
        if (params.clientSubmissionId) {
          const existing = this.runStore.findBySubmissionId(
            sessionId,
            params.clientSubmissionId,
          );
          if (existing) {
            this.sendClientResult(client, id, method, {
              run: toPublicRunSnapshot(existing),
              deduplicated: true,
            });
            return;
          }
        }

        if (this.runStore.corruptedRuns.size > 0) {
          this.sendClientError(
            client,
            id,
            "RUN_CORRUPT",
            "A run manifest is corrupt; unknown submissions cannot safely be replayed",
          );
          return;
        }

        const blocking = this.getCurrentOrBlockingRun();
        if (blocking?.state === "UNCERTAIN") {
          this.sendClientError(
            client,
            id,
            "RUN_CONFLICT",
            `Run ${blocking.runId} is in UNCERTAIN state and requires run.reconcile before starting a new run`,
            false,
          );
          return;
        }

        if (this.isBusy() || blocking !== null) {
          if (params.queue === true) {
            const queuedRecord = this.runStore.createRun({
              sessionId,
              message: params.message,
              title: params.title,
              clientSubmissionId: params.clientSubmissionId,
              requireVerification: params.requireVerification === true,
              queued: true,
            });
            this.broadcastRunEvent("run.created", queuedRecord);
            this.sendClientResult(client, id, method, {
              run: toPublicRunSnapshot(queuedRecord),
              deduplicated: false,
            });
            return;
          }
          this.sendClientError(
            client,
            id,
            "RUN_BUSY",
            "Pi System host already has an active run",
            true,
          );
          return;
        }

        const record = this.runStore.createRun({
          sessionId,
          message: params.message,
          title: params.title,
          clientSubmissionId: params.clientSubmissionId,
          requireVerification: params.requireVerification === true,
          queued: false,
        });
        this.broadcastRunEvent("run.created", record);
        this.dispatchRunBackendPrompt(record, params.message);
        this.sendClientResult(client, id, method, {
          run: toPublicRunSnapshot(record),
          deduplicated: false,
        });
        return;
      }

      if (method === "run.cancel") {
        const record = params.runId
          ? this.runStore.getRun(params.runId)
          : this.getCurrentOrBlockingRun();
        if (!record) {
          this.sendClientError(
            client,
            id,
            "RUN_NOT_FOUND",
            "No matching run found to cancel",
          );
          return;
        }
        if (TERMINAL_RUN_STATES.has(record.state)) {
          this.sendClientResult(client, id, method, {
            run: toPublicRunSnapshot(record),
            cancelScope: "already_terminal",
          });
          return;
        }
        if (record.state === "ACCEPTED" && record.queued === true) {
          this.runStore.transition(record, {
            state: "CANCELLED",
            stateReason: "QUEUED_RUN_CANCELLED",
            lastStep: "queued.cancelled",
            queued: false,
            result: {
              outcome: "cancelled",
              partial: false,
              message: params.reason ?? "Queued run cancelled before execution",
              cancelScope: "queued_removed",
              verificationRefs: [],
            },
            eventName: "run.settled",
          });
          this.broadcastRunEvent("run.settled", record);
          this.sendClientResult(client, id, method, {
            run: toPublicRunSnapshot(record),
            cancelScope: "queued_removed",
          });
          return;
        }

        if (
          record.state === "VERIFYING" &&
          !this.activeRun &&
          !this.promptReserved
        ) {
          this.runStore.transition(record, {
            state: "CANCELLED",
            stateReason: "CANCELLED_DURING_VERIFICATION",
            lastStep: "verification.cancelled",
            result: {
              outcome: "cancelled",
              partial: record.actions.some((a) => a.effectState === "applied"),
              message:
                params.reason ?? "Run cancelled while awaiting verification",
              cancelScope: "turn_and_tools_stopped",
              verificationRefs: [],
            },
            eventName: "run.settled",
          });
          if (this.currentRunId === record.runId) {
            this.currentRunId = undefined;
          }
          this.broadcastRunEvent("run.settled", record);
          this.sendClientResult(client, id, method, {
            run: toPublicRunSnapshot(record),
            cancelScope: "turn_abort_requested",
          });
          return;
        }

        this.runStore.transition(record, {
          state: "CANCELLING",
          stateReason: "CANCEL_REQUESTED",
          lastStep: "cancel.requested",
          eventName: "run.updated",
        });
        this.broadcastRunEvent("run.updated", record);
        this.cancelPendingUi();

        if (this.backend?.stdin?.writable) {
          const backendId = `host-cancel-${randomUUID()}`;
          const timer = setTimeout(() => {
            this.handleRequestTimeout(backendId);
          }, this.requestTimeoutMs);
          timer.unref?.();
          this.pending.set(backendId, {
            internalRun: true,
            runId: record.runId,
            method: "agent.abort",
            timer,
          });
          line(this.backend.stdin, {
            protocolVersion: PROTOCOL_VERSION,
            kind: "request",
            id: backendId,
            method: "agent.abort",
            params: {},
          });
        }

        this.sendClientResult(client, id, method, {
          run: toPublicRunSnapshot(record),
          cancelScope: "turn_abort_requested",
        });
        return;
      }

      if (method === "run.verify") {
        this.sendClientError(
          client,
          id,
          "PERMISSION_DENIED",
          "Frontend assertions are not goal evidence; a host-executed readback is required",
        );
        return;
      }

      if (method === "run.reconcile") {
        if (params.effectState !== "unknown") {
          this.sendClientError(
            client,
            id,
            "PERMISSION_DENIED",
            "Effect assertions require trusted host inspection; no frontend replay authorization",
          );
          return;
        }

        const record = this.runStore.getRun(params.runId);
        if (!record) {
          this.sendClientError(
            client,
            id,
            "RUN_NOT_FOUND",
            `Run ${params.runId} not found`,
          );
          return;
        }
        this.runStore.reconcileRun(record, params);
        const stillUncertain =
          this.runStore.getActiveOrBlockingRun()?.state === "UNCERTAIN";
        this.uncertainRun = Boolean(stillUncertain);
        if (
          TERMINAL_RUN_STATES.has(record.state) &&
          this.currentRunId === record.runId
        ) {
          this.currentRunId = undefined;
        }
        const outEvent = TERMINAL_RUN_STATES.has(record.state)
          ? "run.settled"
          : "run.updated";
        this.broadcastRunEvent(outEvent, record);
        if (record.state === "SUCCEEDED") {
          this.maybeStartNextQueuedRun();
        }
        this.sendClientResult(client, id, method, {
          run: toPublicRunSnapshot(record),
        });
        return;
      }

      if (method === "run.resume") {
        const record = this.runStore.getRun(params.runId);
        if (!record) {
          this.sendClientError(
            client,
            id,
            "RUN_NOT_FOUND",
            `Run ${params.runId} not found`,
          );
          return;
        }
        if (record.state !== "RESUMABLE") {
          this.sendClientError(
            client,
            id,
            "RUN_CONFLICT",
            `Run ${record.runId} is in state ${record.state}; only RESUMABLE runs verified as not_applied may be resumed`,
            false,
          );
          return;
        }
        if (this.isBusy()) {
          this.sendClientError(
            client,
            id,
            "RUN_BUSY",
            "Pi System host is currently busy with another run",
            true,
          );
          return;
        }
        const resumeMessage =
          params.message ?? record.pendingMessage ?? record.title;
        this.dispatchRunBackendPrompt(record, resumeMessage);
        this.sendClientResult(client, id, method, {
          run: toPublicRunSnapshot(record),
        });
        return;
      }
    } catch (error) {
      const code = error?.code ?? "INTERNAL_ERROR";
      this.sendClientError(
        client,
        id,
        code,
        error instanceof Error ? error.message : "Run operation failed",
        false,
      );
    }
  }

  handleClientRequest(client, frame) {
    if (!isRequest(frame)) {
      this.sendClientError(
        client,
        frame?.id,
        "INVALID_REQUEST",
        "Invalid frontend request",
      );
      return;
    }
    if (!isKnownRequestMethod(frame.method)) {
      this.sendClientError(
        client,
        frame.id,
        "UNKNOWN_METHOD",
        `Unknown method: ${frame.method}`,
      );
      return;
    }
    if (!isValidRequestParams(frame.method, frame.params)) {
      this.sendClientError(
        client,
        frame.id,
        "INVALID_REQUEST",
        `Invalid params for ${frame.method}`,
      );
      return;
    }
    if (
      client.inflight.size >= MAX_INFLIGHT_PER_CLIENT ||
      this.pending.size >= MAX_INFLIGHT_TOTAL
    ) {
      this.sendClientError(
        client,
        frame.id,
        "SESSION_BUSY",
        "Frontend request limit reached",
        true,
      );
      return;
    }
    if (client.inflight.has(frame.id)) {
      this.sendClientError(
        client,
        frame.id,
        "INVALID_REQUEST",
        "Request id is already in flight",
      );
      return;
    }
    if (frame.method.startsWith("run.")) {
      this.handleRunClientRequest(client, frame);
      return;
    }
    if (
      this.isBusy() &&
      (SESSION_BUSY_MUTATIONS.has(frame.method) ||
        frame.method === "agent.prompt" ||
        ((frame.method === "agent.steer" ||
          frame.method === "agent.followUp") &&
          (this.uncertainRun || this.promptReserved)))
    ) {
      this.sendClientError(
        client,
        frame.id,
        "SESSION_BUSY",
        "Pi System session has an active turn",
        true,
      );
      return;
    }
    let uiId;
    if (frame.method === "ui.respond") {
      uiId = frame.params.id;
      const pendingUi = this.pendingUi.get(uiId);
      if (!pendingUi || pendingUi.responding) {
        this.sendClientError(
          client,
          frame.id,
          "PERMISSION_DENIED",
          "No matching pending approval exists",
        );
        return;
      }
      pendingUi.responding = true;
    }
    if (
      frame.method === "agent.prompt" ||
      (frame.method === "agent.followUp" && !this.isBusy())
    ) {
      this.promptReserved = true;
    }
    const backendId = `host-${randomUUID()}`;
    const timer = setTimeout(() => {
      this.handleRequestTimeout(backendId);
    }, this.requestTimeoutMs);
    timer.unref?.();
    client.inflight.add(frame.id);
    this.pending.set(backendId, {
      client,
      clientId: frame.id,
      method: frame.method,
      uiId,
      timer,
    });
    try {
      line(this.backend.stdin, {
        protocolVersion: PROTOCOL_VERSION,
        kind: "request",
        id: backendId,
        method: frame.method,
        params: frame.params,
      });
    } catch {
      clearTimeout(timer);
      this.pending.delete(backendId);
      client.inflight.delete(frame.id);
      if (uiId) {
        const pendingUi = this.pendingUi.get(uiId);
        if (pendingUi) pendingUi.responding = false;
      }
      if (
        frame.method === "agent.prompt" ||
        frame.method === "agent.followUp"
      ) {
        this.clearPromptReservation();
      }
      this.sendClientError(
        client,
        frame.id,
        "RPC_DISCONNECTED",
        "Pi frontend is disconnected",
        true,
      );
    }
  }

  handleRequestTimeout(backendId) {
    const request = this.pending.get(backendId);
    if (!request) return;
    this.pending.delete(backendId);
    if (request.internalUi) {
      this.emitUiResolved(request.uiId, request.outcome);
      return;
    }
    if (request.internalRun) {
      this.handleInternalRunBackendResponse(request, {
        ok: false,
        error: {
          code: "REQUEST_TIMEOUT",
          message: "Pi backend request timed out",
        },
      });
      return;
    }
    request.client.inflight.delete(request.clientId);
    if (request.uiId) {
      const pendingUi = this.pendingUi.get(request.uiId);
      if (pendingUi) pendingUi.responding = false;
    }
    const startsTurn =
      request.method === "agent.prompt" || request.method === "agent.followUp";
    if (startsTurn) {
      this.activeRun = true;
      this.uncertainRun = true;
      this.clearPromptReservation();
    }
    if (!request.client.socket.destroyed) {
      this.sendClientError(
        request.client,
        request.clientId,
        "REQUEST_TIMEOUT",
        "Pi backend request timed out",
      );
    }
  }

  isBusy() {
    const activeRunRecord = this.getCurrentOrBlockingRun();
    const hasActiveRunRecord = Boolean(
      activeRunRecord &&
      (ACTIVE_EXECUTION_STATES.has(activeRunRecord.state) ||
        activeRunRecord.state === "UNCERTAIN"),
    );
    return (
      this.activeRun ||
      this.uncertainRun ||
      this.promptReserved ||
      this.pendingUi.size > 0 ||
      hasActiveRunRecord
    );
  }

  sendClientError(client, id, code, message, retryable = false) {
    const error = makeError(code, message, retryable);
    if (id === undefined) {
      this.sendClientEvent(client, "error", { error });
      return;
    }
    line(client.socket, {
      protocolVersion: PROTOCOL_VERSION,
      kind: "response",
      id,
      ok: false,
      error,
    });
  }

  sendClientEvent(client, event, data, sessionId) {
    if (!isValidEventData(event, data)) return;
    if (client.socket.destroyed) return;
    if (client.socket.writableLength > MAX_CLIENT_WRITE_BUFFER) {
      client.socket.destroy();
      return;
    }
    line(client.socket, {
      protocolVersion: PROTOCOL_VERSION,
      kind: "event",
      sequence: ++client.sequence,
      event,
      ...(typeof (sessionId ?? this.state?.session?.id) === "string"
        ? { sessionId: sessionId ?? this.state.session.id }
        : {}),
      data,
    });
  }

  async stop(exitCode = 0) {
    if (this.stopping) return;
    this.stopping = true;
    clearTimeout(this.verificationTimer);
    this.clearPromptReservation();
    this.cancelPendingUi();
    for (const pending of this.pending.values()) {
      if (pending.timer) clearTimeout(pending.timer);
    }
    this.pending.clear();
    const backend = this.backend;
    if (backend && backend.exitCode === null) {
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          try {
            backend.kill("SIGKILL");
          } catch {
            // Process may already be dead
          }
        }, 3_000);
        backend.once("close", () => {
          clearTimeout(timer);
          resolve();
        });
        try {
          backend.kill("SIGTERM");
        } catch {
          clearTimeout(timer);
          resolve();
        }
      });
    }
    for (const client of this.clients.values()) client.socket.destroy();
    this.clients.clear();
    if (this.server) {
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 3_000);
        this.server.close(() => {
          clearTimeout(timer);
          resolve();
        });
      });
      this.server = undefined;
    }
    try {
      const socketStats = lstatSync(this.socketPath);
      if (
        this.socketIdentity &&
        socketStats.isSocket() &&
        socketStats.dev === this.socketIdentity.dev &&
        socketStats.ino === this.socketIdentity.ino &&
        socketStats.uid === this.socketIdentity.uid
      ) {
        rmSync(this.socketPath);
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    if (exitCode !== 0) process.exitCode = exitCode;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  let host;
  try {
    host = new PiSystemHost();
    await host.start();
    const stop = () => void host.stop(0);
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
  } catch (error) {
    process.stderr.write(
      `pi-system-host: ${error instanceof Error ? error.message : "startup failed"}\n`,
    );
    await host?.stop(1);
    process.exitCode = 1;
  }
}
