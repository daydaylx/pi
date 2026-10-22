#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import path, { extname } from "node:path";
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
// Deprecated since protocol package 1.4.0: `work` is the only workflow mode.
const WORKFLOW_MODES = ["work"];
const PERMISSION_LEVELS = ["readonly", "project-write", "confirm-all", "yolo"];
// Canonical order of all 7 permission levels from extensions/shared/workflow-status.ts:6-13
const ALL_PERMISSION_LEVELS = [
  "readonly",
  "project-write",
  "confirm-all",
  "yolo",
  "yolo-ask",
  "yolo-full",
  "headless",
];

function writeJsonLine(stream, value) {
  stream.write(`${JSON.stringify(value)}\n`);
}

function frontendError(code, message) {
  return Object.assign(new Error(message), { code });
}

/**
 * The normal Pi path is an executable or launcher script. Test and embedded
 * integrations may deliberately point at a JavaScript entry point instead;
 * invoke an existing JS file through the current Node binary so its shebang
 * handling cannot change the argument vector or swallow `--version`.
 * Missing paths are left untouched so spawn still reports ENOENT and callers
 * can expose the more useful PI_NOT_FOUND error.
 */
function commandForPi(piPath, args) {
  const extension = extname(piPath).toLowerCase();
  if (
    existsSync(piPath) &&
    (extension === ".js" || extension === ".mjs" || extension === ".cjs")
  ) {
    return { command: process.execPath, args: [piPath, ...args] };
  }
  return { command: piPath, args };
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
    const invocation = commandForPi(piPath, ["--version"]);
    const child = spawn(invocation.command, invocation.args, {
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
    // `exit` only means that the process has exited. Its stdio streams may
    // still have buffered data, so reading `stdout` here races the final
    // `data` event and can turn a valid version into an empty string. `close`
    // is emitted after the stdio streams have closed and is the correct
    // lifecycle point for evaluating the captured output.
    child.once("close", (code) => {
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

/**
 * Runtime lines whose RPC contract is verified against frontend protocol v1.
 * This stays an explicit allowlist: adding a line is a deliberate, test-backed
 * decision, never a wildcard.
 */
const SUPPORTED_PI_LINES = Object.freeze([
  { major: 0, minor: 84 },
  { major: 1, minor: 0 },
  { major: 1, minor: 2 },
  { major: 1, minor: 3 },
]);

export function assertCompatiblePiVersion(rawVersion) {
  const version = typeof rawVersion === "string" ? rawVersion : "";
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-|$)/.exec(version);
  const supported =
    match !== null &&
    SUPPORTED_PI_LINES.some(
      (line) =>
        line.major === Number(match[1]) && line.minor === Number(match[2]),
    );
  if (supported) return;
  // `version` is raw executable output: echo it only when it looks like one.
  const shown =
    version.length <= 60 && /^\d+\.\d+\.\d+[0-9A-Za-z.+-]*$/.test(version)
      ? version
      : "unknown";
  const lines = SUPPORTED_PI_LINES.map(
    (line) => `${line.major}.${line.minor}.x`,
  ).join(", ");
  throw Object.assign(
    frontendError(
      "PI_START_FAILED",
      "Installed Pi version is incompatible with frontend protocol v1",
    ),
    {
      publicMessage: `Installed Pi ${shown} is not supported by frontend protocol v1 (supported: ${lines})`,
    },
  );
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

// session.current erlaubt am Modell nur provider und id (strenges Ergebnisschema); model.list behält die Zusatzfelder.
function normalizeCurrentModel(raw) {
  const model = normalizeModel(raw);
  return model ? { provider: model.provider, id: model.id } : null;
}

export function normalizeCurrentSession(state) {
  return {
    ...(typeof state?.sessionId === "string" ? { id: state.sessionId } : {}),
    ...(typeof state?.sessionName === "string"
      ? { name: state.sessionName }
      : {}),
    connected: true,
    ...(state?.model !== undefined
      ? { model: normalizeCurrentModel(state.model) }
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

const MESSAGE_PAGE_BUDGET = 100_000;

function truncateMessageToBudget(message) {
  const truncated = structuredClone(message);
  while (JSON.stringify([truncated]).length > MESSAGE_PAGE_BUDGET) {
    const textBlocks = truncated.blocks.filter(
      (block) => typeof block.text === "string" && block.text.length > 0,
    );
    if (textBlocks.length === 0) break;
    textBlocks.sort((left, right) => right.text.length - left.text.length);
    const block = textBlocks[0];
    const marker = "…[gekürzt]";
    if (block.text.length <= marker.length) block.text = "";
    else {
      const keep = Math.max(
        0,
        Math.floor((block.text.length - marker.length) / 2),
      );
      block.text = `${block.text.slice(0, keep)}${marker}`;
    }
  }
  return truncated;
}

function paginateMessages(messages, params) {
  const limit = params.limit ?? 100;
  let end = messages.length;
  if (params.before !== undefined) {
    const match = /^o:(0|[1-9]\d*)$/.exec(params.before);
    if (!match || Number(match[1]) > messages.length) {
      throw frontendError("INVALID_REQUEST", "Invalid message cursor");
    }
    end = Number(match[1]);
  }
  let start = Math.max(0, end - limit);
  let page = messages.slice(start, end);
  while (page.length > 1 && JSON.stringify(page).length > MESSAGE_PAGE_BUDGET) {
    page = page.slice(1);
    start += 1;
  }
  if (page.length === 1 && JSON.stringify(page).length > MESSAGE_PAGE_BUDGET) {
    page[0] = truncateMessageToBudget(page[0]);
  }
  return {
    messages: page,
    ...(start > 0 ? { nextCursor: `o:${start}` } : {}),
  };
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

const UI_DIALOG_METHODS = new Set(["confirm", "select", "input", "editor"]);

function publicRuntimeEvent(message) {
  if (message?.type === "message_start") {
    return {
      event: "message.started",
      data: { message: normalizeMessage(message.message) },
    };
  }
  if (message?.type === "message_update") {
    // Runtime >= 1.0 sends delta-only wire records: the text share lives in
    // `assistantMessageEvent`; `delta`/`message` remain for older runtimes.
    const update = message.assistantMessageEvent;
    const textDelta =
      update?.type === "text_delta" && typeof update.delta === "string"
        ? update.delta
        : undefined;
    const delta = typeof message.delta === "string" ? message.delta : textDelta;
    if (delta !== undefined || message.message) {
      return {
        event: "message.delta",
        data: {
          ...(delta !== undefined ? { delta } : {}),
          ...(message.message
            ? { message: normalizeMessage(message.message) }
            : {}),
        },
      };
    }
    if (update?.type === "thinking_start") {
      return { event: "thinking.started", data: {} };
    }
    if (update?.type === "thinking_delta" && typeof update.delta === "string") {
      return { event: "thinking.delta", data: { delta: update.delta } };
    }
    if (update?.type === "thinking_end") {
      return { event: "thinking.completed", data: {} };
    }
    // text_start/text_end, toolcall_*, start and unknown types have no public
    // event: tool lifecycle comes from tool_execution_*, the final text from
    // message_end. They are dropped, never reinterpreted.
    return undefined;
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
        ...(["write", "edit"].includes(message.toolName) &&
        typeof message.args?.path === "string"
          ? { targetPath: message.args.path }
          : {}),
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
        ...(message.toolName === "system_file_verify" &&
        message.result?.details?.goalCheck &&
        !message.isError
          ? {
              goalCheck: {
                filePath: message.result.details.goalCheck.filePath,
                expectedSha256: message.result.details.goalCheck.expectedSha256,
              },
            }
          : {}),
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
    // Fire-and-forget UI methods (setStatus, setWidget, setTitle,
    // set_editor_text) expect no response and are not part of the contract.
    if (!UI_DIALOG_METHODS.has(message.method)) return undefined;
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

const FRONTEND_INDEX_FILE = ".frontend-index.json";

async function loadFrontendIndex(sessionDir) {
  if (!sessionDir) return { version: 1, sessions: {} };
  const indexPath = path.join(sessionDir, FRONTEND_INDEX_FILE);
  try {
    const raw = await readFile(indexPath, "utf8");
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      parsed.version === 1 &&
      parsed.sessions &&
      typeof parsed.sessions === "object" &&
      !Array.isArray(parsed.sessions)
    ) {
      return parsed;
    }
    return { version: 1, sessions: {} };
  } catch {
    return { version: 1, sessions: {} };
  }
}

async function saveFrontendIndex(sessionDir, index) {
  const indexPath = path.join(sessionDir, FRONTEND_INDEX_FILE);
  const tempPath = path.join(
    sessionDir,
    `${FRONTEND_INDEX_FILE}.tmp.${randomUUID()}`,
  );
  const content = JSON.stringify(index, null, 2);
  try {
    await writeFile(tempPath, content, { encoding: "utf8", mode: 0o600 });
    await chmod(tempPath, 0o600).catch(() => {});
    await rename(tempPath, indexPath);
  } catch (error) {
    await unlink(tempPath).catch(() => {});
    throw error;
  }
}

function opaqueSession(session, index) {
  const indexed = index?.sessions?.[session.id];
  const name =
    typeof indexed?.title === "string" ? indexed.title : session.name;
  return {
    id: session.id,
    ...(name ? { name } : {}),
    cwd: session.cwd,
    createdAt: session.created.toISOString(),
    updatedAt: session.modified.toISOString(),
    messageCount: session.messageCount,
    firstMessage: session.firstMessage,
    ...(indexed?.archived === true ? { archived: true } : {}),
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
      const invocation = commandForPi(this.piPath, ["--mode", "rpc"]);
      const child = spawn(invocation.command, invocation.args, {
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

function hasControlCharacter(text) {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
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
      // A version incompatibility is permanent: say so and do not invite retries.
      const incompatible = typeof error?.publicMessage === "string";
      writeJsonLine(this.output, {
        kind: "hello",
        accepted: false,
        error: protocolError(
          missing ? "PI_NOT_FOUND" : "PI_START_FAILED",
          missing
            ? "Pi executable not found"
            : incompatible
              ? error.publicMessage.slice(0, 200)
              : "Pi could not be started",
          randomUUID(),
          { retryable: !incompatible },
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
      capabilities: CAPABILITIES.filter(
        (capability) =>
          capability !== "host-epoch" &&
          capability !== "approval-envelope" &&
          capability !== "runs",
      ),
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

  async emitInitialSnapshot(currentSession) {
    try {
      const current = currentSession ?? normalizeCurrentSession(
        await this.runtime.request({ type: "get_state" }),
      );
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
      if (message.type === "agent_settled") {
        this.emit("agent.settled", {
          aborted: message.aborted === true,
        });
      }
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
        const index = await loadFrontendIndex(
          this.env.PI_CODING_AGENT_SESSION_DIR,
        );
        return {
          sessions: sessions.map((session) => opaqueSession(session, index)),
        };
      }
      case "session.create": {
        await runtime.request({ type: "new_session" });
        const current = normalizeCurrentSession(await runtime.request({ type: "get_state" }));
        await this.emitInitialSnapshot(current);
        return current;
      }
      case "session.open": {
        const sessionPath = this.sessionPaths.get(params.id);
        if (!sessionPath)
          throw frontendError("SESSION_NOT_FOUND", "Session not found");
        await runtime.request({ type: "switch_session", sessionPath });
        const current = normalizeCurrentSession(await runtime.request({ type: "get_state" }));
        await this.emitInitialSnapshot(current);
        return current;
      }
      case "session.rename":
      case "session.archive":
      case "session.delete":
        return this.mutateSession(method, params);
      case "session.current": {
        const current = normalizeCurrentSession(await runtime.request({ type: "get_state" }));
        await this.emitInitialSnapshot(current);
        return current;
      }
      case "session.messages": {
        let messages;
        if (params.id !== undefined) {
          const sessionPath = this.sessionPaths.get(params.id);
          if (!sessionPath)
            throw frontendError("SESSION_NOT_FOUND", "Session not found");
          messages = normalizeMessageEntries(
            SessionManager.open(sessionPath).getEntries(),
          );
        } else {
          messages = normalizeMessagesResult(
            await runtime.request({ type: "get_messages" }),
          ).messages;
        }
        return paginateMessages(messages, params);
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
        // Deprecated since protocol package 1.4.0. The planning workflow no
        // longer exists: "work" is always in force, so selecting it is a no-op
        // and the retired plan modes are refused instead of silently ignored.
        if (params.mode !== "work") {
          throw frontendError(
            "UNSUPPORTED_CAPABILITY",
            `Workflow mode ${params.mode} is no longer supported; only "work" exists.`,
          );
        }
        return {};
      case "permission.list":
        return {
          levels: [...PERMISSION_LEVELS],
          entries: ALL_PERMISSION_LEVELS.map((level) => ({
            level,
            settable: PERMISSION_LEVELS.includes(level),
          })),
        };
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
      case "run.submit":
      case "run.current":
      case "run.get":
      case "run.list":
      case "run.cancel":
      case "run.events":
      case "run.reconcile":
      case "run.resume":
      case "run.verify":
        throw frontendError(
          "UNSUPPORTED_CAPABILITY",
          `${method} requires PiSystemHost`,
        );
      default:
        throw frontendError("UNKNOWN_METHOD", `Unknown method: ${method}`);
    }
  }

  async mutateSession(method, params) {
    const sessionDir = this.env.PI_CODING_AGENT_SESSION_DIR;
    if (!sessionDir) {
      throw frontendError(
        "INVALID_REQUEST",
        "Session management requires a dedicated session directory",
      );
    }
    if (this.state.activity?.kind !== "idle") {
      throw frontendError("SESSION_BUSY", "Session has an active turn");
    }
    if (
      typeof params?.id !== "string" ||
      params.id.length < 1 ||
      params.id.length > 128 ||
      !/^[A-Za-z0-9_-]+$/.test(params.id)
    ) {
      throw frontendError("INVALID_REQUEST", "Invalid session id");
    }

    if (method === "session.rename") {
      if (typeof params.title !== "string") {
        throw frontendError("INVALID_REQUEST", "Title must be a string");
      }
      if (hasControlCharacter(params.title)) {
        throw frontendError(
          "INVALID_REQUEST",
          "Title contains control characters",
        );
      }
      const trimmedTitle = params.title.trim();
      if (trimmedTitle.length > 120) {
        throw frontendError(
          "INVALID_REQUEST",
          "Title must not exceed 120 characters",
        );
      }
    } else if (method === "session.archive") {
      if (typeof params.archived !== "boolean") {
        throw frontendError("INVALID_REQUEST", "archived must be a boolean");
      }
    } else if (method === "session.delete") {
      if (params.confirm !== true) {
        throw frontendError(
          "INVALID_REQUEST",
          "Deletion requires confirm: true",
        );
      }
    }

    const currentState = await this.runtime.request({ type: "get_state" });
    const currentSession = normalizeCurrentSession(currentState);
    if (currentSession.id && currentSession.id === params.id) {
      throw frontendError("SESSION_BUSY", "Cannot modify active session");
    }

    const sessions = await SessionManager.listAll(sessionDir);
    this.sessionPaths = new Map(
      sessions.map((session) => [session.id, session.path]),
    );
    const sessionPath = this.sessionPaths.get(params.id);
    if (!sessionPath) {
      throw frontendError("INVALID_REQUEST", "Session not found");
    }

    if (method === "session.rename") {
      const trimmedTitle = params.title.trim();
      const index = await loadFrontendIndex(sessionDir);
      if (!index.sessions) index.sessions = {};
      if (trimmedTitle.length === 0) {
        if (index.sessions[params.id]) {
          delete index.sessions[params.id].title;
          if (Object.keys(index.sessions[params.id]).length === 0) {
            delete index.sessions[params.id];
          }
        }
      } else {
        if (!index.sessions[params.id]) index.sessions[params.id] = {};
        index.sessions[params.id].title = trimmedTitle;
      }
      await saveFrontendIndex(sessionDir, index);
      return {};
    }

    if (method === "session.archive") {
      const index = await loadFrontendIndex(sessionDir);
      if (!index.sessions) index.sessions = {};
      if (params.archived) {
        if (!index.sessions[params.id]) index.sessions[params.id] = {};
        index.sessions[params.id].archived = true;
      } else {
        if (index.sessions[params.id]) {
          delete index.sessions[params.id].archived;
          if (Object.keys(index.sessions[params.id]).length === 0) {
            delete index.sessions[params.id];
          }
        }
      }
      await saveFrontendIndex(sessionDir, index);
      return {};
    }

    if (method === "session.delete") {
      const stats = await lstat(sessionPath);
      if (stats.isSymbolicLink() || !stats.isFile()) {
        throw frontendError(
          "INVALID_REQUEST",
          "Session path must be a regular file",
        );
      }
      const realSessionPath = await realpath(sessionPath);
      const realSessionDir = await realpath(sessionDir);
      if (path.dirname(realSessionPath) !== realSessionDir) {
        throw frontendError(
          "INVALID_REQUEST",
          "Session file must reside directly in session directory",
        );
      }
      const trashDir = path.join(sessionDir, ".trash");
      await mkdir(trashDir, { recursive: true, mode: 0o700 });
      await chmod(trashDir, 0o700).catch(() => {});
      const basename = path.basename(sessionPath);
      const targetPath = path.join(trashDir, `${basename}.${Date.now()}`);
      await rename(sessionPath, targetPath);

      const index = await loadFrontendIndex(sessionDir);
      if (index.sessions?.[params.id]) {
        delete index.sessions[params.id];
        await saveFrontendIndex(sessionDir, index);
      }
      this.sessionPaths.delete(params.id);
      return {};
    }

    throw frontendError("UNKNOWN_METHOD", `Unknown method: ${method}`);
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
      SESSION_BUSY: "Session is busy",
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
