/**
 * JSON-RPC 2.0 transport over LSP stdio framing.
 *
 * Responsibilities (issue #93):
 *   - `Content-Length` framing that survives fragmented and coalesced chunks.
 *   - Request/response correlation with per-request timeout and cancellation.
 *   - Outbound notifications and server-to-client message dispatch.
 *
 * No `setInterval` is used anywhere (the repo's test harness forbids repeating
 * timers in active extensions); every timer is a one-shot `setTimeout`.
 */

import type { Writable } from "node:stream";
import type { Readable } from "node:stream";
import type {
  JsonRpcError,
  JsonRpcMessage,
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcResponse,
} from "./types.ts";

const HEADER_TERMINATOR = Buffer.from("\r\n\r\n");

export interface ParsedStream {
  messages: JsonRpcMessage[];
  /** Unconsumed bytes that did not yet form a complete message. */
  rest: Buffer;
}

/**
 * Pure, side-effect-free parser. Extracts every complete LSP message from
 * `buffer` and returns the trailing remainder. Exported for deterministic
 * unit testing of fragmented/coalesced framing without spawning a server.
 */
export function parseStreamChunk(buffer: Buffer): ParsedStream {
  const messages: JsonRpcMessage[] = [];
  let remaining = buffer;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const headerEnd = remaining.indexOf(HEADER_TERMINATOR);
    if (headerEnd === -1) break;

    const headerBlock = remaining.subarray(0, headerEnd).toString("utf8");
    const match = /Content-Length:\s*(\d+)/i.exec(headerBlock);
    if (!match) {
      // No usable header: drop through the terminator to make progress and
      // avoid an infinite loop on malformed input.
      remaining = remaining.subarray(headerEnd + HEADER_TERMINATOR.length);
      continue;
    }

    const length = Number(match[1]);
    if (!Number.isFinite(length) || length < 0) {
      remaining = remaining.subarray(headerEnd + HEADER_TERMINATOR.length);
      continue;
    }

    const bodyStart = headerEnd + HEADER_TERMINATOR.length;
    if (remaining.length < bodyStart + length) break; // body still incomplete

    const body = remaining.subarray(bodyStart, bodyStart + length);
    try {
      const parsed = JSON.parse(body.toString("utf8"));
      if (isJsonRpcMessage(parsed)) messages.push(parsed);
    } catch {
      // Malformed JSON body: skip it but keep advancing the stream.
    }
    remaining = remaining.subarray(bodyStart + length);
  }

  return { messages, rest: remaining };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonRpcMessage(value: unknown): value is JsonRpcMessage {
  return isObject(value) && value.jsonrpc === "2.0";
}

function isResponse(value: JsonRpcMessage): value is JsonRpcResponse {
  return (
    !("method" in value) &&
    "id" in value &&
    ("result" in value || "error" in value)
  );
}


export interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: JsonRpcError | Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface TransportHandlers {
  /** Any non-response message (notification or server-initiated request). */
  onMessage?(message: JsonRpcMessage): void;
  /** Stream-level or protocol-level failure. */
  onError?(error: Error): void;
}

export interface TransportOptions {
  /** Default per-request timeout in ms. */
  requestTimeoutMs?: number;
  /** Called for outbound/inbound framing events; never dumps raw bodies. */
  logger?: (level: "error" | "info" | "trace", message: string) => void;
}

export interface RequestOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

export class LspTransport {
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  private closed = false;
  private readonly requestTimeoutMs: number;

  constructor(
    private readonly stdin: Writable,
    stdout: Readable,
    private readonly handlers: TransportHandlers = {},
    options: TransportOptions = {},
  ) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
    stdout.on("data", this.onData);
    stdout.on("error", this.onStreamError);
    stdout.on("end", () => this.failAll("server stream ended"));
    stdout.on("close", () =>
      this.failAll("server stream closed"),
    );
    // A missing-binary or a crashed/exited server makes stdin writes fail with
    // EPIPE. Without a listener Node would crash the host on that 'error'
    // event; we swallow it once the transport is closing.
    this.stdin.on("error", (error) => {
      if (this.closed) return;
      this.handlers.onError?.(error);
    });
  }

  private readonly onData = (chunk: Buffer): void => {
    if (this.closed) return;
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const { messages, rest } = parseStreamChunk(this.buffer);
    this.buffer = rest;
    for (const message of messages) this.dispatch(message);
  };

  private readonly onStreamError = (error: Error): void => {
    this.handlers.onError?.(error);
    this.failAll(`server stream error: ${error.message}`);
  };

  private dispatch(message: JsonRpcMessage): void {
    if (isResponse(message)) {
      const pending = this.pending.get(Number(message.id));
      if (!pending) return;
      // settle() owns deletion so exactly one of resolve/reject/timeout wins;
      // deleting here would make settle's winner-guard skip the resolution.
      if (message.error) pending.reject(message.error);
      else pending.resolve(message.result);
      return;
    }
    // Notifications and server-initiated requests are forwarded verbatim.
    // Server requests are not answered in v1; higher layers (#94+) may handle.
    this.handlers.onMessage?.(message);
  }

  sendRequest(
    method: string,
    params?: unknown,
    options: RequestOptions = {},
  ): Promise<unknown> {
    if (this.closed) {
      return Promise.reject(
        new Error("LSP transport closed; request not sent."),
      );
    }
    const id = this.nextId++;
    const request: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
    const timeoutMs = options.timeoutMs ?? this.requestTimeoutMs;

    return new Promise((resolve, reject) => {
      let settled = false;
      const signal = options.signal;
      let timer: ReturnType<typeof setTimeout>;

      // Every settlement path (resolve/reject/timeout/cancel) runs through one
      // of these so there is exactly one winner, the timer is cleared, the
      // pending entry is removed and any AbortSignal listener is detached.
      const doResolve = (value: unknown): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        this.pending.delete(id);
        resolve(value);
      };
      const doReject = (error: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        this.pending.delete(id);
        reject(error);
      };
      const onAbort = (): void => {
        try {
          this.sendNotification("$/cancelRequest", { id });
        } catch {
          /* ignore */
        }
        doReject(makeCancelError(method));
      };

      timer = setTimeout(
        () => doReject(makeTimeoutError(method, timeoutMs)),
        timeoutMs,
      );

      this.pending.set(id, {
        resolve: doResolve,
        reject: doReject,
        timer,
      });

      if (signal) {
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
      }

      this.write(request);
    });
  }

  /** Send a notification (fire and forget, no id, no response expected). */
  sendNotification(method: string, params?: unknown): void {
    if (this.closed) return;
    const notification: JsonRpcNotification = {
      jsonrpc: "2.0",
      method,
      params,
    };
    this.write(notification);
  }

  private write(message: JsonRpcMessage): void {
    const body = Buffer.from(JSON.stringify(message), "utf8");
    const header = Buffer.from(
      `Content-Length: ${body.length}\r\n\r\n`,
      "utf8",
    );
    this.stdin.write(Buffer.concat([header, body]));
  }

  /**
   * Reject every in-flight request. Called on close and stream failures so no
   * caller waits forever for a server that is gone. Each pending handler runs
   * its own winner guard (timer/listener cleanup), so this is idempotent and
   * safe to call repeatedly (e.g. from both stream 'end' and 'close').
   */
  private failAll(reason: string): void {
    for (const pending of [...this.pending.values()]) {
      pending.reject(new Error(`LSP request failed: ${reason}`));
    }
  }

  /** Detach from the server stream and reject pending requests. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.failAll("transport closed");
  }

  get pendingCount(): number {
    return this.pending.size;
  }
}

function makeTimeoutError(method: string, timeoutMs: number): Error {
  const error = new Error(
    `LSP request '${method}' timed out after ${timeoutMs}ms`,
  );
  (error as Error & { code?: string }).code = "LSP_TIMEOUT";
  return error;
}

function makeCancelError(method: string): Error {
  const error = new Error(`LSP request '${method}' was cancelled`);
  (error as Error & { code?: string }).code = "LSP_CANCELLED";
  return error;
}
