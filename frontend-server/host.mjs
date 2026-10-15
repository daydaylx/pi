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
  negotiateProtocolVersion,
  protocolError,
} from "../npm/packages/frontend-protocol/dist/index.js";

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
  for (const directory of [root, system, workspace, sessions]) {
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
  return { agentDir: canonicalAgentDir, workspace, sessions };
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
    this.state = undefined;
    this.activeRun = false;
    this.uncertainRun = false;
    this.promptReserved = false;
    this.promptReservationTimer = undefined;
    this.stopping = false;
  }

  async start() {
    this.hostEpoch = randomUUID();
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
      if (request.internalUi) {
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
        if (frame.result?.isStreaming === false && this.pendingUi.size === 0) {
          this.activeRun = false;
          this.uncertainRun = false;
          this.clearPromptReservation();
        } else if (frame.result?.isStreaming === true) {
          this.activeRun = true;
          this.uncertainRun = false;
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
    if (active) {
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
      capabilities: [...CAPABILITIES, "shared-session-owner"],
      hostEpoch: this.hostEpoch,
    });
    this.sendClientEvent(client, "state.snapshot", this.state);
    for (const pending of this.pendingUi.values()) {
      this.sendClientEvent(client, "extension-ui.requested", pending.data);
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
    request.client.inflight.delete(request.clientId);
    if (request.uiId) {
      const pendingUi = this.pendingUi.get(request.uiId);
      if (pendingUi) pendingUi.responding = false;
    }
    const startsTurn =
      request.method === "agent.prompt" ||
      request.method === "agent.followUp";
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
    return (
      this.activeRun ||
      this.uncertainRun ||
      this.promptReserved ||
      this.pendingUi.size > 0
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
