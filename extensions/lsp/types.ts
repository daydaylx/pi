/**
 * Shared types for the optional, read-only LSP integration.
 *
 * Scope of v1 (#93–#98): diagnostics, definition, references, hover and
 * workspace symbols over stdio + JSON-RPC/LSP 3.17. This file intentionally
 * keeps only the subset of the specification that Pi actually exchanges; it is
 * not a full LSP type model.
 *
 * This module is dependency-free and side-effect-free.
 */

/** JSON-RPC 2.0 error object as returned by a server. */
export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

export type JsonRpcMessage =
  | JsonRpcRequest
  | JsonRpcResponse
  | JsonRpcNotification;

/**
 * Discriminated, agent-friendly failure categories. Every LSP operation that
 * can fail MUST surface a {@link LspStructuredError} so callers (and the Pi
 * agent) can act on the cause instead of guessing from a stack trace.
 */
export type LspErrorKind =
  | "missing_binary"
  | "spawn_error"
  | "timeout"
  | "cancelled"
  | "crashed"
  | "shutdown"
  | "protocol"
  | "request_failed"
  | "not_ready";

export interface LspStructuredError {
  /** Stable machine-readable category. */
  kind: LspErrorKind;
  /** Server profile id, e.g. "typescript" or "python". */
  serverId: string;
  /** Absolute workspace root the server was started for. */
  workspaceRoot: string;
  /** LSP method that was attempted, when applicable. */
  method?: string;
  /** Human-readable concrete cause. */
  cause: string;
  /** Optional, actionable remediation hint. */
  remediation?: string;
  /** Original JSON-RPC error data when the server returned one. */
  data?: unknown;
}

/**
 * Build a structured error that also satisfies `Error` so it can be thrown and
 * caught normally while remaining introspectable by callers.
 */
export class LspError extends Error {
  readonly kind: LspErrorKind;
  readonly serverId: string;
  readonly workspaceRoot: string;
  readonly method?: string;
  readonly remediation?: string;
  readonly data?: unknown;

  constructor(details: LspStructuredError) {
    const method = details.method ? ` ${details.method}` : "";
    super(
      `LSP ${details.kind} (${details.serverId}@${details.workspaceRoot}${method}): ${details.cause}`,
    );
    this.name = "LspError";
    this.kind = details.kind;
    this.serverId = details.serverId;
    this.workspaceRoot = details.workspaceRoot;
    this.method = details.method;
    this.remediation = details.remediation;
    this.data = details.data;
  }

  toStructured(): LspStructuredError {
    return {
      kind: this.kind,
      serverId: this.serverId,
      workspaceRoot: this.workspaceRoot,
      method: this.method,
      cause: this.message,
      remediation: this.remediation,
      data: this.data,
    };
  }
}

/** Subset of `InitializeParams` that Pi sends. */
export interface LspInitializeParams {
  processId: number | null;
  clientInfo?: { name: string; version?: string };
  locale?: string;
  rootUri: string | null;
  capabilities: Record<string, unknown>;
  initializationOptions?: unknown;
  workspaceFolders?: { uri: string; name: string }[];
}

/** Server capabilities returned by `initialize`. Kept opaque (raw object). */
export interface LspInitializeResult {
  capabilities: Record<string, unknown>;
  serverInfo?: { name: string; version?: string };
}

/** Lightweight logger sink; levels match the planned `--lsp-log` flag (#97). */
export type LspLogLevel = "error" | "info" | "trace";
export type LspLogger = (level: LspLogLevel, message: string) => void;
