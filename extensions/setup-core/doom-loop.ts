/**
 * Doom-loop and stuck-agent detection for issue #103.
 *
 * Observes tool results at runtime, normalises each call into a short
 * deterministic signature, and tracks a bounded per-session history. When
 * a repeated-failure pattern is detected an advisory status label is published
 * via Aurora so the agent or the user can intervene *before* the model's
 * context budget is exhausted.
 *
 * The core detection logic is pure and testable; the thin event-wiring
 * (`registerDoomLoopDetector`) hooks into pi's `tool_result` event.
 *
 * Design constraints (from the issue):
 *   - Deterministic and configurable thresholds.
 *   - No automatic permission or thinking escalation.
 *   - Sensitive tool output is hashed, never stored in full.
 *   - History is session-scoped; cleaned up at `session_shutdown`.
 */
import { createHash } from "node:crypto";
import type { ExtensionAPI, ToolCallEvent } from "@earendil-works/pi-coding-agent";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface DoomLoopConfig {
  /** How many recent results to keep in the ring buffer. */
  historySize: number;
  /**
   * Same (toolName, signature) failing this many times in the examined window
   * triggers an "identical-failure" loop detection.
   */
  identicalFailureThreshold: number;
  /** How many recent entries to examine for identical failures. */
  identicalFailureWindow: number;
  /**
   * Same toolName failing this many times in the examined window triggers a
   * "stuck-tool" detection.
   */
  stuckToolThreshold: number;
  /** How many recent entries to examine for stuck-tool patterns. */
  stuckToolWindow: number;
}

export const DEFAULT_CONFIG: DoomLoopConfig = {
  historySize: 30,
  identicalFailureThreshold: 2,
  identicalFailureWindow: 10,
  stuckToolThreshold: 3,
  stuckToolWindow: 8,
};

// ---------------------------------------------------------------------------
// Normalised entry
// ---------------------------------------------------------------------------

export interface NormalisedEntry {
  toolName: string;
  /** Short signature: tool-specific fields that identify "the same call". */
  signature: string;
  isError: boolean;
  /** Timestamp in ms (Date.now) — used only for ordering, never for timeouts. */
  timestamp: number;
}

/**
 * Deterministic per-tool signature. Includes just enough fields so that
 * repeated identical calls produce the same signature, but not so much that
 * every legitimately different call looks different.
 */
export function normaliseSignature(event: {
  toolName: string;
  input?: Record<string, unknown>;
}): string {
  const { toolName, input = {} } = event;
  const parts: string[] = [toolName];
  // Normalise each field that we extract: cast to string, trim, lowercase
  // (makes oldText matches slightly more tolerant of whitespace drift).
  const norm = (value: unknown): string => String(value ?? "").trim().toLowerCase();

  switch (toolName) {
    case "edit":
      parts.push("e:" + norm(input.oldText));
      parts.push("p:" + norm(input.path ?? input.filePath ?? ""));
      break;
    case "write":
      parts.push("p:" + norm(input.path ?? input.filePath ?? contentHash(norm(input.content))));
      break;
    case "read":
      parts.push("p:" + norm(input.path));
      break;
    case "bash":
      parts.push("c:" + norm(input.command));
      break;
    case "grep":
      parts.push("p:" + norm(input.path ?? input.pattern ?? ""));
      break;
    case "find":
      parts.push("p:" + norm(input.path ?? ""));
      break;
    case "ls":
      parts.push("p:" + norm(input.path ?? ""));
      break;
    default:
      // Custom tools: hash the whole input so even unknown tools get a stable id.
      parts.push("custom:" + contentHash(JSON.stringify(input)));
      break;
  }
  return parts.join("|");
}

function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 12);
}

// ---------------------------------------------------------------------------
// Ring buffer
// ---------------------------------------------------------------------------

export class HistoryBuffer {
  private entries: NormalisedEntry[] = [];
  readonly maxSize: number;

  constructor(maxSize = 30) {
    this.maxSize = maxSize;
  }

  push(entry: NormalisedEntry): void {
    this.entries.push(entry);
    if (this.entries.length > this.maxSize) {
      this.entries = this.entries.slice(-this.maxSize);
    }
  }

  /** Most recent N entries (from the end). */
  tail(n: number): NormalisedEntry[] {
    return this.entries.slice(-Math.min(n, this.entries.length));
  }

  /** Number of stored entries. */
  get length(): number {
    return this.entries.length;
  }

  /** Remove all entries. */
  clear(): void {
    this.entries.length = 0;
  }
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

export interface LoopDetection {
  kind: "identical-failure" | "stuck-tool";
  toolName: string;
  /** Human-readable explanation (for a status label or notification). */
  message: string;
  /** How many times the pattern was observed in the examined window. */
  occurrences: number;
}

/**
 * Match the current entry against recent history and return up to one
 * detection (the first match wins in the order: identical-failure, stuck-tool).
 * Returns `undefined` when no threshold is met.
 */
export function detectLoop(
  entry: NormalisedEntry,
  history: NormalisedEntry[],
  config: DoomLoopConfig = DEFAULT_CONFIG,
): LoopDetection | undefined {
  // Identical-failure: same toolName + same signature + both errors.
  if (entry.isError) {
    const window = history.slice(-config.identicalFailureWindow);
    const identicalErrors = window.filter(
      (e) =>
        e.isError &&
        e.toolName === entry.toolName &&
        e.signature === entry.signature,
    );
    if (identicalErrors.length >= config.identicalFailureThreshold) {
      return {
        kind: "identical-failure",
        toolName: entry.toolName,
        message: `${entry.toolName}: identischer fehlgeschlagener Aufruf (${identicalErrors.length + 1}x) — mögliche Doom-Loop.`,
        occurrences: identicalErrors.length + 1,
      };
    }
  }

  // Stuck-tool: same toolName failing N times in window.
  if (entry.isError) {
    const window = history.slice(-config.stuckToolWindow);
    const toolErrors = window.filter(
      (e) => e.isError && e.toolName === entry.toolName,
    );
    if (toolErrors.length >= config.stuckToolThreshold) {
      return {
        kind: "stuck-tool",
        toolName: entry.toolName,
        message: `${entry.toolName}: ${toolErrors.length + 1}x fehlgeschlagen im letzten Fenster — Agent scheint festzuhängen.`,
        occurrences: toolErrors.length + 1,
      };
    }
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Extension wiring
// ---------------------------------------------------------------------------

export interface DoomLoopState {
  history: HistoryBuffer;
  config: DoomLoopConfig;
  /** The most recent detection, if any. Cleared on new non-error results. */
  lastDetection?: LoopDetection;
}

export function createDoomLoopState(config?: Partial<DoomLoopConfig>): DoomLoopState {
  const resolved = { ...DEFAULT_CONFIG, ...config };
  return { history: new HistoryBuffer(resolved.historySize), config: resolved };
}

/**
 * Register the doom-loop detector. Hooks `tool_result` and updates
 * state as tool calls complete. Session-scoped; history is cleared on
 * `session_shutdown`.
 */
export function registerDoomLoopDetector(
  pi: ExtensionAPI,
  state: DoomLoopState = createDoomLoopState(),
): DoomLoopState {
  pi.on("tool_result", (event) => {
    const entry: NormalisedEntry = {
      toolName: event.toolName,
      signature: normaliseSignature(event),
      isError: event.isError,
      timestamp: Date.now(),
    };
    state.history.push(entry);
    if (!entry.isError) {
      // A successful result breaks the loop perception.
      state.lastDetection = undefined;
      return;
    }
    const detection = detectLoop(
      entry,
      state.history.tail(state.config.identicalFailureWindow * 2),
      state.config,
    );
    if (detection) {
      state.lastDetection = detection;
      // Advisory: publish a label visible in the Aurora footer so both
      // the agent and the user can see the warning.
      pi.appendEntry("doom-loop", detection);
    }
  });

  pi.on("session_shutdown", () => {
    state.history.clear();
    state.lastDetection = undefined;
  });

  return state;
}
