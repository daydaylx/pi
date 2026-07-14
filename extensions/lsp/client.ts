/**
 * High-level read-only LSP client.
 *
 * Owns a {@link LspProcess} and an {@link LspTransport} and coordinates the
 * LSP handshake (`initialize`/`initialized`), graceful shutdown
 * (`shutdown`/`exit`), crash recovery (re-initialize after a bounded restart)
 * and structured error reporting for every failure mode required by #93.
 *
 * v1 is read-only and lazy: a client is created, but it only spawns a server
 * when {@link LspClient.start} is called (which happens lazily from #94's
 * registry on first real demand).
 */

import { EventEmitter } from "node:events";
import { pathToFileURL } from "node:url";
import { LspError } from "./types.ts";
import type {
  LspInitializeParams,
  LspInitializeResult,
  LspLogger,
  LspLogLevel,
} from "./types.ts";
import { LspProcess } from "./process.ts";
import type { DegradedInfo, LspProcessOptions } from "./process.ts";
import { LspTransport } from "./transport.ts";
import type { RequestOptions } from "./transport.ts";
import type { JsonRpcMessage } from "./types.ts";

export interface LspClientOptions {
  serverId: string;
  workspaceRoot: string;
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  initializationOptions?: unknown;
  /** Per-request timeout in ms. Default 10000. */
  requestTimeoutMs?: number;
  logger?: LspLogger;
  /** Forwarded to {@link LspProcess}. */
  process?: Pick<
    LspProcessOptions,
    "maxRestarts" | "backoffBaseMs" | "backoffMaxMs" | "shutdownGraceMs"
  >;
}

export type LspClientState =
  "idle" | "starting" | "ready" | "restarting" | "degraded" | "shutdown";

/**
 * Emitted events:
 *  - `state`: the client moved to a new state.
 *  - `notification`: a server-to-client notification (e.g. diagnostics in #95).
 *  - `degraded`: the server cannot recover; payload is an {@link LspError}.
 *  - `restart`: the underlying process restarted and is re-initializing.
 */
export class LspClient extends EventEmitter {
  readonly serverId: string;
  readonly workspaceRoot: string;

  private state: LspClientState = "idle";
  private readonly proc: LspProcess;
  private transport?: LspTransport;
  private capabilities?: Record<string, unknown>;
  private initializing = false;
  private readonly logger: LspLogger;
  private readonly initOptions?: unknown;
  private readonly requestTimeoutMs: number;
  private startPromise?: Promise<LspInitializeResult>;
  private startResolve?: (value: LspInitializeResult) => void;
  private startReject?: (error: LspError) => void;

  constructor(private readonly options: LspClientOptions) {
    super();
    this.serverId = options.serverId;
    this.workspaceRoot = options.workspaceRoot;
    this.logger = options.logger ?? (() => undefined);
    this.initOptions = options.initializationOptions;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 10_000;

    this.proc = new LspProcess({
      command: options.command,
      args: options.args,
      cwd: options.cwd ?? options.workspaceRoot,
      env: options.env,
      logger: this.logger,
      ...options.process,
    });

    this.proc.on("ready", () => this.onProcessReady());
    this.proc.on("exit", (info) =>
      this.logger(
        "info",
        `process exit code=${info.code} signal=${info.signal}`,
      ),
    );
    this.proc.on("stderr", (chunk: Buffer) => {
      const text = chunk.toString("utf8").trimEnd();
      if (text) this.logger("trace", `server stderr: ${text}`);
    });
    this.proc.on("restart", (info: { attempt: number; delayMs: number }) => {
      this.logger("info", `restarting (attempt ${info.attempt})`);
      this.setState("restarting");
      this.emit("restart", info);
    });
    this.proc.on("degraded", (info: DegradedInfo) => this.onDegraded(info));
  }

  get currentState(): LspClientState {
    return this.state;
  }

  /** Raw server capabilities after `initialize`, or undefined. */
  get serverCapabilities(): Record<string, unknown> | undefined {
    return this.capabilities;
  }

  get pid(): number | undefined {
    return this.proc.pid;
  }

  /** True while a server process is alive (used by lifecycle tests). */
  get processRunning(): boolean {
    return this.proc.running;
  }

  /**
   * Spawn the server and complete the LSP handshake. Resolves with the server
   * capabilities. Rejects with an {@link LspError} on missing binary, spawn
   * failure or handshake error.
   */
  start(): Promise<LspInitializeResult> {
    if (this.startPromise) return this.startPromise;
    this.setState("starting");
    this.startPromise = new Promise<LspInitializeResult>((resolve, reject) => {
      this.startResolve = resolve;
      this.startReject = reject;
      // Defer start so callers can attach listeners synchronously.
      queueMicrotask(() => {
        if (this.state === "shutdown") {
          reject(this.toError("shutdown", "client shut down before start"));
          return;
        }
        this.proc.start();
      });
    });
    return this.startPromise;
  }

  /** Send a request once the server is ready. Enforces timeout/cancellation. */
  async request<T = unknown>(
    method: string,
    params?: unknown,
    options?: RequestOptions,
  ): Promise<T> {
    const transport = this.requireTransport(method);
    try {
      const result = await transport.sendRequest(method, params, {
        timeoutMs: options?.timeoutMs ?? this.requestTimeoutMs,
        signal: options?.signal,
      });
      return result as T;
    } catch (error) {
      throw this.wrapTransportError(error, method);
    }
  }

  /** Send a notification (e.g. `textDocument/didOpen` in #95). */
  notify(method: string, params?: unknown): void {
    this.transport?.sendNotification(method, params);
  }

  /** Subscribe to server-to-client notifications. */
  onNotification(handler: (message: JsonRpcMessage) => void): void {
    this.on("notification", handler);
  }

  /** Graceful LSP shutdown: `shutdown`, `exit`, then kill. Leaves no orphan. */
  async shutdown(): Promise<void> {
    if (this.state === "shutdown") return;
    // Capture readiness BEFORE mutating state; otherwise the readiness check
    // below would always be false and the graceful `shutdown` request skipped.
    const wasReady = this.currentStateWasReady();
    const transport = this.transport;
    this.setState("shutdown");

    if (transport && wasReady) {
      try {
        await transport.sendRequest("shutdown", undefined, {
          timeoutMs: Math.min(this.requestTimeoutMs, 2_000),
        });
      } catch {
        /* server may already be gone; fall through to exit + kill */
      }
    }
    try {
      transport?.sendNotification("exit");
    } catch {
      /* ignore */
    }
    await this.proc.stop();
    transport?.close();
    this.transport = undefined;
  }

  private currentStateWasReady(): boolean {
    return this.state === "ready" || this.state === "restarting";
  }

  private requireTransport(method: string): LspTransport {
    if (!this.transport || this.state !== "ready") {
      throw this.toError(
        "not_ready",
        `server is ${this.state}; cannot call ${method}`,
        method,
      );
    }
    return this.transport;
  }

  /** Process emitted `ready` (initial or after restart): bind a fresh transport. */
  private onProcessReady(): void {
    const previous = this.transport;
    if (previous) previous.close();
    const stdin = this.proc.stdin;
    const stdout = this.proc.stdout;
    if (!stdin || !stdout) {
      this.onDegraded({
        cause: "spawn_error",
        message: "missing stdio streams",
      });
      return;
    }
    this.transport = new LspTransport(
      stdin,
      stdout,
      {
        onMessage: (message) => this.emit("notification", message),
        onError: (error) =>
          this.logger("error", `transport error: ${error.message}`),
      },
      { requestTimeoutMs: this.requestTimeoutMs },
    );
    void this.runInitialize();
  }

  private async runInitialize(): Promise<void> {
    if (this.state === "shutdown" || this.initializing) return;
    this.initializing = true;
    const params: LspInitializeParams = {
      processId: process.pid,
      clientInfo: { name: "pi-lsp", version: "0.1.0" },
      rootUri: pathToFileURL(this.workspaceRoot).href,
      capabilities: CLIENT_CAPABILITIES,
      initializationOptions: this.initOptions,
    };
    try {
      const result = (await this.transport!.sendRequest("initialize", params, {
        timeoutMs: this.requestTimeoutMs,
      })) as LspInitializeResult;
      this.transport!.sendNotification("initialized", {});
      this.capabilities = result?.capabilities ?? {};
      this.setState("ready");
      this.startResolve?.(result);
      this.startResolve = undefined;
      this.startReject = undefined;
    } catch (error) {
      const wrapped = this.wrapTransportError(error, "initialize");
      this.startReject?.(wrapped);
      this.startResolve = undefined;
      this.startReject = undefined;
      // A failed handshake degrades the client.
      this.onDegraded({
        cause: "spawn_error",
        message: `initialize failed: ${wrapped.cause}`,
      });
    } finally {
      this.initializing = false;
    }
  }

  private onDegraded(info: DegradedInfo): void {
    if (this.state === "shutdown") return;
    const kind: LspError["kind"] =
      info.cause === "missing_binary"
        ? "missing_binary"
        : info.cause === "repeated_crash"
          ? "crashed"
          : "spawn_error";
    const error = this.toError(kind, info.message);
    this.setState("degraded");
    // Tear down the transport so any abandoned in-flight request (e.g. a
    // hanging initialize) rejects promptly instead of waiting for its timer.
    this.transport?.close();
    this.startReject?.(error);
    this.startResolve = undefined;
    this.startReject = undefined;
    this.emit("degraded", error);
  }

  private wrapTransportError(error: unknown, method: string): LspError {
    if (error instanceof LspError) return error;
    const code = readCode(error);
    const kind =
      code === "LSP_TIMEOUT"
        ? "timeout"
        : code === "LSP_CANCELLED"
          ? "cancelled"
          : "request_failed";
    const data = isRpcError(error) ? error : undefined;
    return this.toError(
      kind,
      error instanceof Error ? error.message : String(error),
      method,
      data,
    );
  }

  private toError(
    kind: LspError["kind"],
    cause: string,
    method?: string,
    data?: unknown,
  ): LspError {
    return new LspError({
      kind,
      serverId: this.serverId,
      workspaceRoot: this.workspaceRoot,
      method,
      cause,
      remediation: remediationFor(kind, this.options.command),
      data,
    });
  }

  private setState(next: LspClientState): void {
    if (this.state === next) return;
    this.state = next;
    this.emit("state", next);
  }

  log(level: LspLogLevel, message: string): void {
    this.logger(level, message);
  }
}

/**
 * Capabilities Pi advertises. v1 only consumes read-only features; we still
 * announce incremental text document sync so #95 can sync changes correctly.
 */
const CLIENT_CAPABILITIES = {
  textDocument: {
    synchronization: { didOpen: true, didChange: true, didClose: true },
    hover: { contentFormat: ["markdown", "plaintext"] },
    // #96: without declaring linkSupport, servers never return
    // LocationLink[] for textDocument/definition — only Location/Location[]
    // — which would make the tool's preferLinks parameter a no-op.
    definition: { linkSupport: true },
    references: {},
  },
  workspace: {
    symbol: {},
  },
} as const;

function isRpcError(
  value: unknown,
): { code: number; message: string; data?: unknown } | undefined {
  if (
    value &&
    typeof value === "object" &&
    "code" in value &&
    "message" in value
  ) {
    return value as { code: number; message: string; data?: unknown };
  }
  return undefined;
}

function readCode(error: unknown): string | undefined {
  if (error && typeof error === "object" && "code" in error) {
    return String((error as { code: unknown }).code);
  }
  return undefined;
}

function remediationFor(
  kind: LspError["kind"],
  command: string,
): string | undefined {
  switch (kind) {
    case "missing_binary":
      return `Install the server binary ('${command}') or disable the profile in .pi/lsp.json.`;
    case "timeout":
      return "Raise requestTimeoutMs or restart the server with /lsp restart.";
    case "crashed":
      return "Check /lsp log for server stderr; the server may be misconfigured.";
    default:
      return undefined;
  }
}
