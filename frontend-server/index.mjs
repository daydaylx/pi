#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { pathToFileURL, fileURLToPath } from "node:url";
import { SessionManager } from "../npm/node_modules/@earendil-works/pi-coding-agent/dist/index.js";
import {
  CAPABILITIES,
  PROTOCOL_PACKAGE_VERSION,
  PROTOCOL_VERSION,
  isClientHello,
  isKnownEventName,
  isKnownRequestMethod,
  isRequest,
  isStatePatchV1,
  isStateSnapshotV1,
  isValidRequestParams,
  isValidRequestResult,
  isValidEventData,
  negotiateProtocolVersion,
  protocolError,
} from "../npm/packages/frontend-protocol/dist/index.js";

const REQUEST_TIMEOUT_MS = 30_000;
const VERSION_TIMEOUT_MS = 5_000;
const STDERR_LIMIT = 2_000;
const PINNED_PI_PATH = fileURLToPath(
  new URL("../npm/node_modules/.bin/pi", import.meta.url),
);
const WORKFLOW_MODES = ["work", "simple_plan", "detailed_plan"];
const PERMISSION_LEVELS = ["readonly", "project-write", "confirm-all", "yolo"];

function writeJsonLine(stream, value) {
  stream.write(`${JSON.stringify(value)}\n`);
}

function frontendError(code, message) {
  return Object.assign(new Error(message), { code });
}

export function attachJsonlReader(stream, onValue, onParseError) {
  let buffer = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    buffer += chunk;
    while (true) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) break;
      const line = buffer.slice(0, newline).replace(/\r$/, "");
      buffer = buffer.slice(newline + 1);
      if (line.trim()) parseLine(line, onValue, onParseError);
    }
  });
  stream.on("end", () => {
    if (buffer.trim())
      parseLine(buffer.replace(/\r$/, ""), onValue, onParseError);
  });
}

function parseLine(line, onValue, onParseError) {
  try {
    onValue(JSON.parse(line));
  } catch {
    onParseError(line.slice(0, 500));
  }
}

export function readPiVersion(piPath, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(piPath, ["--version"], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let done = false;
    const finish = (error, version) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(version);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(
        frontendError("PI_START_FAILED", "Timed out while reading Pi version"),
      );
    }, VERSION_TIMEOUT_MS);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout = `${stdout}${chunk}`.slice(0, 200);
    });
    child.once("error", (error) => finish(error));
    child.once("exit", (code) => {
      const version = stdout.trim();
      if (code !== 0 || !version) {
        finish(
          frontendError(
            "PI_START_FAILED",
            "Pi version could not be determined",
          ),
        );
      } else finish(undefined, version);
    });
  });
}

export function assertCompatiblePiVersion(version) {
  if (!/^0\.84\.\d+(?:-|$)/.test(version)) {
    throw frontendError(
      "PI_START_FAILED",
      "Installed Pi version is incompatible with frontend protocol v1",
    );
  }
}

function normalizeModel(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = raw.id ?? raw.modelId;
  if (typeof raw.provider !== "string" || typeof id !== "string") return null;
  return {
    provider: raw.provider,
    id,
    ...(typeof raw.name === "string" ? { name: raw.name } : {}),
    ...(Number.isFinite(raw.contextWindow)
      ? { contextWindow: raw.contextWindow }
      : {}),
    ...(typeof raw.reasoning === "boolean" ? { reasoning: raw.reasoning } : {}),
  };
}

function normalizeCurrentSession(state) {
  return {
    ...(typeof state?.sessionId === "string" ? { id: state.sessionId } : {}),
    ...(typeof state?.sessionName === "string"
      ? { name: state.sessionName }
      : {}),
    connected: true,
    ...(state?.model !== undefined
      ? { model: normalizeModel(state.model) }
      : {}),
    ...(typeof state?.thinkingLevel === "string"
      ? { thinkingLevel: state.thinkingLevel }
      : {}),
    isStreaming: state?.isStreaming === true,
    messageCount: Number.isInteger(state?.messageCount)
      ? state.messageCount
      : 0,
  };
}

function normalizeBlock(block) {
  if (!block || typeof block !== "object") return { type: "unknown" };
  if (block.type === "text" && typeof block.text === "string") {
    return { type: "text", text: block.text };
  }
  if (block.type === "thinking" && typeof block.thinking === "string") {
    return { type: "thinking", text: block.thinking };
  }
  if (block.type === "toolCall") {
    return {
      type: "tool_call",
      ...(typeof block.id === "string" ? { toolCallId: block.id } : {}),
      ...(typeof block.name === "string" ? { toolName: block.name } : {}),
    };
  }
  if (block.type === "image") return { type: "image" };
  return { type: "unknown" };
}

function normalizeMessage(value, metadata = {}) {
  const message = value?.message ?? value;
  const content =
    value?.type === "custom_message" ? value.content : message?.content;
  let blocks;
  if (typeof content === "string") blocks = [{ type: "text", text: content }];
  else if (Array.isArray(content)) blocks = content.map(normalizeBlock);
  else blocks = [];
  if (message?.role === "toolResult") {
    blocks = blocks.map((block) => ({
      ...block,
      type: block.type === "text" ? "tool_result" : block.type,
      ...(typeof message.toolCallId === "string"
        ? { toolCallId: message.toolCallId }
        : {}),
      ...(typeof message.toolName === "string"
        ? { toolName: message.toolName }
        : {}),
      ...(typeof message.isError === "boolean"
        ? { isError: message.isError }
        : {}),
    }));
  }
  return {
    ...(typeof metadata.id === "string" ? { id: metadata.id } : {}),
    ...(metadata.parentId === null || typeof metadata.parentId === "string"
      ? { parentId: metadata.parentId }
      : {}),
    ...(typeof metadata.timestamp === "string" ||
    typeof metadata.timestamp === "number"
      ? { timestamp: metadata.timestamp }
      : {}),
    role:
      typeof message?.role === "string"
        ? message.role
        : value?.type === "custom_message"
          ? "custom"
          : "unknown",
    blocks,
  };
}

function normalizeMessageEntries(entries) {
  return entries
    .filter(
      (entry) => entry.type === "message" || entry.type === "custom_message",
    )
    .map((entry) => normalizeMessage(entry, entry));
}

function normalizeMessagesResult(raw) {
  const messages = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.messages)
      ? raw.messages
      : [];
  return { messages: messages.map((message) => normalizeMessage(message)) };
}

function normalizeStats(stats) {
  return {
    sessionId: String(stats?.sessionId ?? ""),
    userMessages: Number(stats?.userMessages ?? 0),
    assistantMessages: Number(stats?.assistantMessages ?? 0),
    toolCalls: Number(stats?.toolCalls ?? 0),
    toolResults: Number(stats?.toolResults ?? 0),
    totalMessages: Number(stats?.totalMessages ?? 0),
    tokens: {
      input: Number(stats?.tokens?.input ?? 0),
      output: Number(stats?.tokens?.output ?? 0),
      cacheRead: Number(stats?.tokens?.cacheRead ?? 0),
      cacheWrite: Number(stats?.tokens?.cacheWrite ?? 0),
      total: Number(stats?.tokens?.total ?? 0),
    },
    cost: Number(stats?.cost ?? 0),
    ...(stats?.contextUsage && typeof stats.contextUsage === "object"
      ? {
          contextUsage: {
            tokens: Number.isFinite(stats.contextUsage.tokens)
              ? stats.contextUsage.tokens
              : null,
            contextWindow: Number(stats.contextUsage.contextWindow ?? 1),
            percent: Number.isFinite(stats.contextUsage.percent)
              ? stats.contextUsage.percent
              : null,
          },
        }
      : {}),
  };
}

function normalizeModels(raw) {
  const values = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.models)
      ? raw.models
      : [];
  return values.map(normalizeModel).filter(Boolean);
}

function defaultState(cwd) {
  return {
    session: { cwd, connected: true },
    workflow: { mode: "work", label: "Work", available: [...WORKFLOW_MODES] },
    task: {
      title: "Aktuelle Aufgabe",
      phaseLabel: "Bereit",
      status: "completed",
    },
    activity: { kind: "idle" },
    permissions: { options: [...PERMISSION_LEVELS] },
    lsp: {},
    model: { available: [] },
    thinking: { available: [] },
    changes: null,
    verification: null,
    subagents: [],
    configuration: {},
  };
}

function deriveTaskStatus(state) {
  if (state.subagents.some((entry) => entry.status === "needs_attention"))
    return "needs_input";
  if (
    state.verification?.status &&
    /fail|error|blocked/i.test(state.verification.status)
  ) {
    return "needs_input";
  }
  if (state.activity.kind !== "idle") return "active";
  if ((state.changes?.filesCount ?? 0) > 0) return "review";
  return "completed";
}

export function normalizeBridgeState(internal, current) {
  const patch = {};
  if (internal?.workflow) {
    const mode = WORKFLOW_MODES.includes(internal.workflow.phase)
      ? internal.workflow.phase
      : current.workflow.mode;
    patch.workflow = {
      mode,
      label:
        typeof internal.workflow.label === "string"
          ? internal.workflow.label
          : mode,
      available: [...WORKFLOW_MODES],
    };
  }
  if (internal?.activity?.kind)
    patch.activity = { kind: internal.activity.kind };
  if (internal?.permissions) {
    patch.permissions = {
      ...(typeof internal.permissions.level === "string"
        ? { current: internal.permissions.level }
        : {}),
      ...(typeof internal.permissions.label === "string"
        ? { label: internal.permissions.label }
        : {}),
      options: [...PERMISSION_LEVELS],
    };
  }
  if (internal?.lsp) {
    patch.lsp = {
      ...(typeof internal.lsp.state === "string"
        ? { state: internal.lsp.state }
        : {}),
      ...(typeof internal.lsp.detail === "string"
        ? { detail: internal.lsp.detail }
        : {}),
    };
  }
  if (internal?.model) {
    patch.model = {
      ...(typeof internal.model.id === "string"
        ? { current: internal.model.id }
        : {}),
      available: current.model.available,
    };
    patch.thinking = {
      ...(typeof internal.model.thinking === "string"
        ? { current: internal.model.thinking }
        : {}),
      available: current.thinking.available,
    };
  }
  if ("changes" in (internal ?? {})) {
    patch.changes = internal.changes
      ? {
          filesCount: Number(internal.changes.filesCount ?? 0),
          files: Array.isArray(internal.changes.files)
            ? internal.changes.files
                .filter((path) => typeof path === "string")
                .map((path) => ({ path }))
            : [],
        }
      : null;
  }
  if ("verification" in (internal ?? {})) {
    patch.verification = internal.verification
      ? {
          ...(typeof internal.verification.status === "string"
            ? { status: internal.verification.status }
            : {}),
          requiredOutcomes:
            internal.verification.requiredOutcomes &&
            typeof internal.verification.requiredOutcomes === "object"
              ? internal.verification.requiredOutcomes
              : {},
          blockingRecommendedIds: Array.isArray(
            internal.verification.blockingRecommendedIds,
          )
            ? internal.verification.blockingRecommendedIds.filter(
                (id) => typeof id === "string",
              )
            : [],
        }
      : null;
  }
  if (Array.isArray(internal?.subagents)) {
    patch.subagents = internal.subagents
      .filter(
        (entry) =>
          entry &&
          typeof entry.runId === "string" &&
          typeof entry.agent === "string" &&
          typeof entry.role === "string" &&
          ["running", "paused", "needs_attention", "queued"].includes(
            entry.status,
          ),
      )
      .map(({ runId, agent, role, status }) => ({
        runId,
        agent,
        role,
        status,
      }));
  }
  if (internal?.task) {
    patch.task = {
      title:
        typeof internal.task.title === "string"
          ? internal.task.title
          : current.task.title,
      phaseLabel:
        typeof internal.task.phaseLabel === "string"
          ? internal.task.phaseLabel
          : current.task.phaseLabel,
      status: current.task.status,
    };
  }
  const projected = { ...current, ...patch };
  projected.task = { ...projected.task, status: deriveTaskStatus(projected) };
  patch.task = projected.task;
  return patch;
}

function publicRuntimeEvent(message) {
  if (message?.type === "message_start") {
    return {
      event: "message.started",
      data: { message: normalizeMessage(message.message) },
    };
  }
  if (message?.type === "message_update") {
    return {
      event: "message.delta",
      data: {
        ...(typeof message.delta === "string" ? { delta: message.delta } : {}),
        ...(message.message
          ? { message: normalizeMessage(message.message) }
          : {}),
      },
    };
  }
  if (message?.type === "message_end") {
    return {
      event: "message.completed",
      data: { message: normalizeMessage(message.message) },
    };
  }
  if (message?.type === "tool_execution_start") {
    return {
      event: "tool.started",
      data: {
        toolCallId: String(message.toolCallId ?? ""),
        toolName: String(message.toolName ?? ""),
      },
    };
  }
  if (message?.type === "tool_execution_update") {
    return {
      event: "tool.updated",
      data: {
        toolCallId: String(message.toolCallId ?? ""),
        toolName: String(message.toolName ?? ""),
      },
    };
  }
  if (message?.type === "tool_execution_end") {
    return {
      event: message.isError ? "tool.failed" : "tool.completed",
      data: {
        toolCallId: String(message.toolCallId ?? ""),
        toolName: String(message.toolName ?? ""),
        isError: message.isError === true,
      },
    };
  }
  if (message?.type === "extension_ui_request") {
    if (message.method === "notify") {
      return {
        event: "notification",
        data: {
          message: String(message.message ?? ""),
          level: String(message.notifyType ?? "info"),
        },
      };
    }
    const data = {
      id: String(message.id ?? ""),
      method: String(message.method ?? ""),
      ...(typeof message.title === "string" ? { title: message.title } : {}),
      ...(typeof message.message === "string"
        ? { message: message.message }
        : {}),
      ...(Array.isArray(message.options)
        ? {
            options: message.options.filter(
              (value) => typeof value === "string",
            ),
          }
        : {}),
    };
    return { event: "extension-ui.requested", data };
  }
  if (message?.type === "extension_error") {
    return {
      event: "error",
      data: {
        error: protocolError(
          "INTERNAL_ERROR",
          "A Pi extension reported an error",
          randomUUID(),
        ),
      },
    };
  }
  return undefined;
}

export function mapRuntimeEvent(message, sequence) {
  const mapped = publicRuntimeEvent(message);
  if (!mapped) return undefined;
  return {
    protocolVersion: PROTOCOL_VERSION,
    kind: "event",
    sequence,
    event: mapped.event,
    data: mapped.data,
  };
}

function opaqueSession(session) {
  return {
    id: session.id,
    ...(session.name ? { name: session.name } : {}),
    cwd: session.cwd,
    createdAt: session.created.toISOString(),
    updatedAt: session.modified.toISOString(),
    messageCount: session.messageCount,
    firstMessage: session.firstMessage,
  };
}

class RuntimeRpc {
  constructor({
    piPath,
    cwd,
    env = process.env,
    timeoutMs = REQUEST_TIMEOUT_MS,
  }) {
    this.piPath = piPath;
    this.cwd = cwd;
    this.env = env;
    this.timeoutMs = timeoutMs;
    this.child = undefined;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    this.stderr = "";
    this.stopping = false;
  }

  start() {
    return new Promise((resolve, reject) => {
      const child = spawn(this.piPath, ["--mode", "rpc"], {
        cwd: this.cwd,
        env: { ...this.env, PI_FRONTEND_RPC: "1" },
        stdio: ["pipe", "pipe", "pipe"],
      });
      this.child = child;
      let settled = false;
      child.once("spawn", () => {
        settled = true;
        resolve();
      });
      child.once("error", (error) => {
        if (!settled) reject(error);
        this.rejectAll(
          frontendError(
            error?.code === "ENOENT" ? "PI_NOT_FOUND" : "RPC_DISCONNECTED",
            error?.code === "ENOENT"
              ? "Pi executable not found"
              : "Pi RPC process failed",
          ),
        );
      });
      child.once("exit", (code, signal) => {
        this.child = undefined;
        const error = frontendError(
          "RPC_DISCONNECTED",
          "Pi RPC process disconnected",
        );
        this.rejectAll(error);
        if (!this.stopping) {
          for (const listener of this.listeners)
            listener({ type: "__exit", code, signal });
        }
      });
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => {
        this.stderr = `${this.stderr}${chunk}`.slice(-STDERR_LIMIT);
      });
      attachJsonlReader(
        child.stdout,
        (message) => this.handleMessage(message),
        () => {
          for (const listener of this.listeners)
            listener({ type: "__parse_error" });
        },
      );
    });
  }

  onEvent(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  handleMessage(message) {
    if (
      message?.type === "response" &&
      message.id &&
      this.pending.has(message.id)
    ) {
      const pending = this.pending.get(message.id);
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.success === false) {
        pending.reject(
          frontendError("INTERNAL_ERROR", "Pi RPC request failed"),
        );
      } else pending.resolve(message.data ?? {});
      return;
    }
    for (const listener of this.listeners) listener(message);
  }

  request(command) {
    if (!this.child?.stdin?.writable) {
      return Promise.reject(
        frontendError("RPC_DISCONNECTED", "Pi is disconnected"),
      );
    }
    const id = `frontend-${this.nextId++}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          frontendError(
            "REQUEST_TIMEOUT",
            `Pi request timed out: ${command.type}`,
          ),
        );
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      writeJsonLine(this.child.stdin, { id, ...command });
    });
  }

  send(value) {
    if (!this.child?.stdin?.writable) {
      throw frontendError("RPC_DISCONNECTED", "Pi is disconnected");
    }
    writeJsonLine(this.child.stdin, value);
  }

  rejectAll(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  async stop() {
    const child = this.child;
    if (!child) return;
    this.stopping = true;
    await new Promise((resolve) => {
      let complete = false;
      const finish = () => {
        if (complete) return;
        complete = true;
        clearTimeout(termTimer);
        clearTimeout(killTimer);
        resolve();
      };
      const killTimer = setTimeout(() => {
        finish();
      }, 5_000);
      const termTimer = setTimeout(() => {
        child.kill("SIGKILL");
      }, 3_000);
      child.once("exit", finish);
      child.kill("SIGTERM");
    });
  }
}

export class FrontendServer {
  constructor({
    input = process.stdin,
    output = process.stdout,
    cwd = process.cwd(),
    env = process.env,
  } = {}) {
    this.input = input;
    this.output = output;
    this.cwd = cwd;
    this.env = env;
    this.runtime = undefined;
    this.piVersion = undefined;
    this.handshakeComplete = false;
    this.sequence = 0;
    this.sessionPaths = new Map();
    this.state = defaultState(cwd);
    this.sentStateSnapshot = false;
  }

  start() {
    attachJsonlReader(
      this.input,
      (message) => void this.handle(message),
      () =>
        this.sendProtocolError(
          undefined,
          "INVALID_REQUEST",
          "Invalid JSONL request",
        ),
    );
    this.input.once("end", () => void this.stop());
  }

  async handle(message) {
    if (!this.handshakeComplete) return this.handleHello(message);
    if (!isRequest(message)) {
      return this.sendProtocolError(
        message?.id,
        "INVALID_REQUEST",
        "Invalid frontend request",
      );
    }
    if (!isKnownRequestMethod(message.method)) {
      return this.sendProtocolError(
        message.id,
        "UNKNOWN_METHOD",
        `Unknown method: ${message.method}`,
      );
    }
    if (!isValidRequestParams(message.method, message.params)) {
      return this.sendProtocolError(
        message.id,
        "INVALID_REQUEST",
        `Invalid params for ${message.method}`,
      );
    }
    try {
      const result = await this.dispatch(message.method, message.params);
      if (!isValidRequestResult(message.method, result)) {
        throw frontendError(
          "INTERNAL_ERROR",
          `Invalid Pi result for ${message.method}`,
        );
      }
      writeJsonLine(this.output, {
        protocolVersion: PROTOCOL_VERSION,
        kind: "response",
        id: message.id,
        ok: true,
        result,
      });
    } catch (error) {
      const code = error?.code ?? "INTERNAL_ERROR";
      this.sendProtocolError(
        message.id,
        code,
        this.publicErrorMessage(code, error),
      );
    }
  }

  async handleHello(message) {
    if (!isClientHello(message)) {
      writeJsonLine(this.output, {
        kind: "hello",
        accepted: false,
        error: protocolError(
          "INVALID_REQUEST",
          "A valid hello frame is required",
          randomUUID(),
        ),
      });
      return;
    }
    const negotiated = negotiateProtocolVersion(
      message.supportedProtocolVersions,
    );
    if (!negotiated) {
      writeJsonLine(this.output, {
        kind: "hello",
        accepted: false,
        error: protocolError(
          "PROTOCOL_MISMATCH",
          "GUI and Pi protocol versions are incompatible",
          randomUUID(),
          { details: { supportedProtocolVersions: [PROTOCOL_VERSION] } },
        ),
      });
      return;
    }
    try {
      await this.ensureRuntime();
    } catch (error) {
      const missing =
        error?.code === "ENOENT" || error?.code === "PI_NOT_FOUND";
      writeJsonLine(this.output, {
        kind: "hello",
        accepted: false,
        error: protocolError(
          missing ? "PI_NOT_FOUND" : "PI_START_FAILED",
          missing ? "Pi executable not found" : "Pi could not be started",
          randomUUID(),
          { retryable: true },
        ),
      });
      return;
    }
    this.handshakeComplete = true;
    writeJsonLine(this.output, {
      kind: "hello",
      accepted: true,
      protocolVersion: negotiated,
      serverVersion: PROTOCOL_PACKAGE_VERSION,
      piVersion: this.piVersion,
      capabilities: CAPABILITIES,
    });
    await this.emitInitialSnapshot();
  }

  async ensureRuntime() {
    if (this.runtime) return;
    const piPath = this.env.PI_FRONTEND_PI_PATH || PINNED_PI_PATH;
    this.piVersion = await readPiVersion(piPath, this.env);
    assertCompatiblePiVersion(this.piVersion);
    const configuredTimeout = Number(this.env.PI_FRONTEND_REQUEST_TIMEOUT_MS);
    const runtime = new RuntimeRpc({
      piPath,
      cwd: this.cwd,
      env: this.env,
      timeoutMs:
        Number.isFinite(configuredTimeout) && configuredTimeout >= 50
          ? configuredTimeout
          : REQUEST_TIMEOUT_MS,
    });
    await runtime.start();
    runtime.onEvent((message) => this.handleRuntimeEvent(message));
    this.runtime = runtime;
  }

  async emitInitialSnapshot() {
    try {
      const state = await this.runtime.request({ type: "get_state" });
      const current = normalizeCurrentSession(state);
      this.state.session = {
        ...(current.id ? { id: current.id } : {}),
        ...(current.name ? { name: current.name } : {}),
        cwd: this.cwd,
        connected: true,
      };
      if (current.model)
        this.state.model.current = `${current.model.provider}/${current.model.id}`;
      if (current.thinkingLevel)
        this.state.thinking.current = current.thinkingLevel;
    } catch {
      // The handshake already proved the process is running. A state request
      // failure becomes an empty authoritative snapshot, not a second hello.
    }
    this.emitState("state.snapshot", this.state);
    this.sentStateSnapshot = true;
  }

  handleRuntimeEvent(message) {
    if (message.type === "__exit") {
      this.runtime = undefined;
      this.state.session.connected = false;
      this.emit("core.disconnected", {
        error: protocolError("PI_CRASHED", "Pi process exited", randomUUID(), {
          retryable: true,
        }),
      });
      return;
    }
    if (message.type === "__parse_error") {
      this.emit("error", {
        error: protocolError(
          "INVALID_REQUEST",
          "Pi emitted malformed JSONL",
          randomUUID(),
        ),
      });
      return;
    }
    if (message.type === "entry_appended") {
      const entry = message.entry ?? message.data ?? {};
      if (entry.customType === "frontend-bridge/state") {
        const patch = normalizeBridgeState(entry.data?.state ?? {}, this.state);
        this.state = { ...this.state, ...patch };
        this.emitState(
          this.sentStateSnapshot ? "state.patch" : "state.snapshot",
          this.sentStateSnapshot ? patch : this.state,
        );
        this.sentStateSnapshot = true;
      }
      return;
    }
    if (message.type === "agent_start" || message.type === "agent_settled") {
      const patch = {
        activity: {
          kind: message.type === "agent_start" ? "responding" : "idle",
        },
      };
      this.state = { ...this.state, ...patch };
      this.state.task = {
        ...this.state.task,
        status: deriveTaskStatus(this.state),
      };
      this.emitState("state.patch", { ...patch, task: this.state.task });
      return;
    }
    const event = publicRuntimeEvent(message);
    if (event) this.emit(event.event, event.data);
  }

  emitState(event, data) {
    const valid =
      event === "state.snapshot"
        ? isStateSnapshotV1(data)
        : isStatePatchV1(data);
    if (!valid) {
      this.emit("error", {
        error: protocolError(
          "INTERNAL_ERROR",
          "Pi produced invalid frontend state",
          randomUUID(),
        ),
      });
      return;
    }
    this.emit(event, data);
  }

  emit(event, data) {
    if (!isKnownEventName(event) || !isValidEventData(event, data)) {
      if (event === "error") return;
      const error = protocolError(
        "INTERNAL_ERROR",
        "Pi produced an invalid frontend event",
        randomUUID(),
      );
      writeJsonLine(this.output, {
        protocolVersion: PROTOCOL_VERSION,
        kind: "event",
        sequence: ++this.sequence,
        event: "error",
        data: { error },
      });
      return;
    }
    writeJsonLine(this.output, {
      protocolVersion: PROTOCOL_VERSION,
      kind: "event",
      sequence: ++this.sequence,
      event,
      data,
    });
  }

  async dispatch(method, params) {
    const runtime = this.runtime;
    if (!runtime) throw frontendError("RPC_DISCONNECTED", "Pi is disconnected");
    switch (method) {
      case "system.ping":
        return {
          pong: true,
          protocolVersion: PROTOCOL_VERSION,
          piVersion: this.piVersion,
        };
      case "session.list": {
        const sessions = await SessionManager.listAll(
          this.env.PI_CODING_AGENT_SESSION_DIR,
        );
        this.sessionPaths = new Map(
          sessions.map((session) => [session.id, session.path]),
        );
        return { sessions: sessions.map(opaqueSession) };
      }
      case "session.create":
        await runtime.request({ type: "new_session" });
        return normalizeCurrentSession(
          await runtime.request({ type: "get_state" }),
        );
      case "session.open": {
        const sessionPath = this.sessionPaths.get(params.id);
        if (!sessionPath)
          throw frontendError("SESSION_NOT_FOUND", "Session not found");
        await runtime.request({ type: "switch_session", sessionPath });
        return normalizeCurrentSession(
          await runtime.request({ type: "get_state" }),
        );
      }
      case "session.current":
        return normalizeCurrentSession(
          await runtime.request({ type: "get_state" }),
        );
      case "session.messages": {
        if (params.id !== undefined) {
          const sessionPath = this.sessionPaths.get(params.id);
          if (!sessionPath)
            throw frontendError("SESSION_NOT_FOUND", "Session not found");
          return {
            messages: normalizeMessageEntries(
              SessionManager.open(sessionPath).getEntries(),
            ),
          };
        }
        return normalizeMessagesResult(
          await runtime.request({ type: "get_messages" }),
        );
      }
      case "session.stats":
        return normalizeStats(
          await runtime.request({ type: "get_session_stats" }),
        );
      case "agent.prompt":
        await runtime.request({ type: "prompt", message: params.message });
        return {};
      case "agent.steer":
        await runtime.request({ type: "steer", message: params.message });
        return {};
      case "agent.followUp":
        await runtime.request({ type: "follow_up", message: params.message });
        return {};
      case "agent.abort":
        await runtime.request({ type: "abort" });
        return {};
      case "model.list":
        return {
          models: normalizeModels(
            await runtime.request({ type: "get_available_models" }),
          ),
        };
      case "model.set": {
        const raw = await runtime.request({
          type: "set_model",
          provider: params.provider,
          modelId: params.modelId,
        });
        return { model: normalizeModel(raw) };
      }
      case "model.cycle": {
        const raw = await runtime.request({ type: "cycle_model" });
        return { model: normalizeModel(raw?.model ?? raw) };
      }
      case "thinking.list": {
        const raw = await runtime.request({
          type: "get_available_thinking_levels",
        });
        return {
          levels: Array.isArray(raw?.levels)
            ? raw.levels.filter((value) => typeof value === "string")
            : [],
        };
      }
      case "thinking.set":
        await runtime.request({
          type: "set_thinking_level",
          level: params.level,
        });
        return {};
      case "thinking.cycle": {
        const raw = await runtime.request({ type: "cycle_thinking_level" });
        return { level: typeof raw?.level === "string" ? raw.level : null };
      }
      case "command.list": {
        const raw = await runtime.request({ type: "get_commands" });
        return {
          commands: Array.isArray(raw?.commands)
            ? raw.commands.map((command) => ({
                name: String(command.name ?? ""),
                ...(typeof command.description === "string"
                  ? { description: command.description }
                  : {}),
                ...(typeof command.source === "string"
                  ? { source: command.source }
                  : {}),
                ...(typeof command.location === "string"
                  ? { location: command.location }
                  : {}),
              }))
            : [],
        };
      }
      case "command.invoke":
        await runtime.request({
          type: "prompt",
          message: `/${params.name.replace(/^\//, "")}${params.args ? ` ${params.args}` : ""}`,
        });
        return {};
      case "workflow.list":
        return { modes: [...WORKFLOW_MODES] };
      case "workflow.set":
        await runtime.request({
          type: "prompt",
          message: `/workflow-set ${params.mode}`,
        });
        return {};
      case "permission.list":
        return { levels: [...PERMISSION_LEVELS] };
      case "permission.set":
        await runtime.request({
          type: "prompt",
          message: `/permission ${params.level}`,
        });
        return {};
      case "ui.respond": {
        const response = {
          type: "extension_ui_response",
          id: params.id,
          ...(params.method ? { method: params.method } : {}),
          ...(params.cancelled !== undefined
            ? { cancelled: params.cancelled }
            : {}),
          ...(params.confirmed !== undefined
            ? { confirmed: params.confirmed }
            : {}),
          ...(params.value !== undefined ? { value: params.value } : {}),
        };
        runtime.send(response);
        return { delivered: true };
      }
      case "configuration.get": {
        const state = await runtime.request({ type: "get_state" });
        return {
          ...(state.model !== undefined
            ? { model: normalizeModel(state.model) }
            : {}),
          ...(typeof state.thinkingLevel === "string"
            ? { thinkingLevel: state.thinkingLevel }
            : {}),
        };
      }
      case "changes.list":
        return { changes: this.state.changes?.files ?? [] };
      case "verification.run":
        throw frontendError(
          "UNSUPPORTED_CAPABILITY",
          "verification.run is not directly invokable by this Pi version",
        );
      default:
        throw frontendError("UNKNOWN_METHOD", `Unknown method: ${method}`);
    }
  }

  sendProtocolError(id, code, message) {
    const error = protocolError(code, message, randomUUID(), {
      retryable: [
        "PI_START_FAILED",
        "PI_CRASHED",
        "RPC_DISCONNECTED",
        "REQUEST_TIMEOUT",
      ].includes(code),
    });
    if (!id) return this.emit("error", { error });
    writeJsonLine(this.output, {
      protocolVersion: PROTOCOL_VERSION,
      kind: "response",
      id,
      ok: false,
      error,
    });
  }

  publicErrorMessage(code, error) {
    const messages = {
      PI_NOT_FOUND: "Pi executable not found",
      PI_START_FAILED: "Pi could not be started",
      PI_CRASHED: "Pi exited unexpectedly",
      RPC_DISCONNECTED: "Connection to Pi was interrupted",
      REQUEST_TIMEOUT: "Pi request timed out",
      SESSION_NOT_FOUND: "Session not found",
      SESSION_INVALID: "Session is invalid",
      TOOL_FAILED: "Tool execution failed",
      PERMISSION_DENIED: "Permission denied",
      PROVIDER_ERROR: "Provider request failed",
      INTERNAL_ERROR: "Pi frontend request failed",
      UNSUPPORTED_CAPABILITY: "This Pi capability is not available",
    };
    if (messages[code]) return messages[code];
    if (code === "UNKNOWN_METHOD" || code === "INVALID_REQUEST") {
      return error instanceof Error
        ? error.message.slice(0, 300)
        : "Invalid frontend request";
    }
    return "Pi frontend request failed";
  }

  async stop() {
    await this.runtime?.stop();
  }
}

export function stableSessionId(value) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, 24);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const server = new FrontendServer();
  server.start();
  const stop = async () => {
    await server.stop();
    process.exit(0);
  };
  process.once("SIGTERM", () => void stop());
  process.once("SIGINT", () => void stop());
}
