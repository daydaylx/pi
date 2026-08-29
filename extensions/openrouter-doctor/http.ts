/**
 * Bounded, safe HTTP client for talking to OpenRouter directly.
 *
 * Every request goes through here so the cost/safety limits from the
 * README (timeout, retries, concurrency, circuit breaker) apply uniformly.
 * Nothing in this module ever logs or returns the Authorization header or
 * API key — callers pass credentials in, this module never persists them.
 */
import {
  CIRCUIT_BREAKER_FAILURE_THRESHOLD,
  CIRCUIT_BREAKER_OPEN_MS,
  MAX_CONCURRENT_REQUESTS,
  MAX_RETRY_AFTER_MS,
  MAX_RETRIES,
  REQUEST_TIMEOUT_MS,
  type RawCheckError,
} from "./types.ts";

export interface OrFetchOk {
  ok: true;
  status: number;
  json: unknown;
  headers: Headers;
}
export interface OrFetchFail {
  ok: false;
  error: RawCheckError;
}
export type OrFetchResult = OrFetchOk | OrFetchFail;

/** Consecutive-failure circuit breaker. In-memory only, scoped to one extension instance. */
export class CircuitBreaker {
  private consecutiveFailures = 0;
  private openUntilMs = 0;

  isOpen(): boolean {
    return Date.now() < this.openUntilMs;
  }

  recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.openUntilMs = 0;
  }

  recordFailure(): void {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= CIRCUIT_BREAKER_FAILURE_THRESHOLD) {
      this.openUntilMs = Date.now() + CIRCUIT_BREAKER_OPEN_MS;
    }
  }
}

/** Simple counting semaphore bounding how many requests run at once. */
class RequestGate {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  async acquire(): Promise<() => void> {
    if (this.active >= MAX_CONCURRENT_REQUESTS) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active -= 1;
      const next = this.queue.shift();
      if (next) next();
    };
  }
}

const RETRYABLE_STATUSES = new Set([429, 502, 503, 524, 529]);

function isRetryable(result: OrFetchFail): boolean {
  if (result.error.kind === "network" || result.error.kind === "timeout") return true;
  if (result.error.kind === "http") return RETRYABLE_STATUSES.has(result.error.status);
  return false;
}

function backoffMs(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, 8000);
}

export function parseRetryAfter(headers: Headers): number | undefined {
  const raw = headers.get("retry-after");
  if (!raw) return undefined;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0
    ? Math.min(seconds, MAX_RETRY_AFTER_MS / 1000)
    : undefined;
}

/** Waits for a retry without making a command ignore its caller's cancellation signal. */
function waitForRetry(delayMs: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => finish(true), delayMs);
    const onAbort = () => finish(false);
    const finish = (completed: boolean) => {
      clearTimeout(timeoutId);
      signal.removeEventListener("abort", onAbort);
      resolve(completed);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function parseErrorBody(response: Response): Promise<{ code?: string; message?: string }> {
  try {
    const body = (await response.json()) as { error?: { code?: string; message?: string } };
    return { code: body.error?.code, message: body.error?.message };
  } catch {
    return {};
  }
}

async function performOnce(
  url: string,
  init: RequestInit,
  signal: AbortSignal,
): Promise<OrFetchResult> {
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), REQUEST_TIMEOUT_MS);
  const onExternalAbort = () => timeoutController.abort();
  signal.addEventListener("abort", onExternalAbort);
  try {
    const response = await fetch(url, { ...init, signal: timeoutController.signal });
    if (!response.ok) {
      const { code, message } = await parseErrorBody(response.clone());
      return {
        ok: false,
        error: {
          kind: "http",
          status: response.status,
          code,
          message,
          retryAfterSeconds: parseRetryAfter(response.headers),
        },
      };
    }
    try {
      const json = (await response.json()) as unknown;
      return { ok: true, status: response.status, json, headers: response.headers };
    } catch {
      return { ok: false, error: { kind: "invalid-json" } };
    }
  } catch (caught) {
    if (signal.aborted) return { ok: false, error: { kind: "abort" } };
    if (timeoutController.signal.aborted) return { ok: false, error: { kind: "timeout" } };
    const message = caught instanceof Error ? caught.message : String(caught);
    return { ok: false, error: { kind: "network", message } };
  } finally {
    clearTimeout(timeoutId);
    signal.removeEventListener("abort", onExternalAbort);
  }
}

/**
 * Fetches JSON from OpenRouter with timeout, bounded retry+backoff for
 * retryable failures, and circuit-breaker short-circuiting. `signal` is the
 * caller's cancellation signal (e.g. a whole diagnosis run being aborted).
 */
export async function orFetchJson(
  url: string,
  init: RequestInit,
  deps: { gate: RequestGate; breaker: CircuitBreaker; signal: AbortSignal },
  options: { maxRetries?: number } = {},
): Promise<OrFetchResult> {
  if (deps.breaker.isOpen()) {
    return { ok: false, error: { kind: "network", message: "circuit-open" } };
  }
  const release = await deps.gate.acquire();
  try {
    let lastResult: OrFetchResult = { ok: false, error: { kind: "network" } };
    const maxRetries = options.maxRetries ?? MAX_RETRIES;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      if (deps.signal.aborted) return { ok: false, error: { kind: "abort" } };
      lastResult = await performOnce(url, init, deps.signal);
      if (lastResult.ok) {
        deps.breaker.recordSuccess();
        return lastResult;
      }
      if (lastResult.error.kind === "network" || lastResult.error.kind === "timeout") {
        deps.breaker.recordFailure();
      }
      if (attempt === maxRetries || !isRetryable(lastResult)) break;
      const waitMs =
        lastResult.error.kind === "http" && lastResult.error.retryAfterSeconds !== undefined
          ? lastResult.error.retryAfterSeconds * 1000
          : backoffMs(attempt);
      if (!(await waitForRetry(waitMs, deps.signal))) {
        return { ok: false, error: { kind: "abort" } };
      }
    }
    return lastResult;
  } finally {
    release();
  }
}

export function createRequestGate(): RequestGate {
  return new RequestGate();
}
