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
import type {
  ExtensionAPI,
  ToolCallEvent,
} from "@earendil-works/pi-coding-agent";
import {
  DOOM_LOOP_CAPABILITY_EVENTS,
  type DoomLoopCapabilityRequest,
} from "../shared/doom-loop-capabilities.ts";

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
  /**
   * Same `read` path this many times in the examined window (without an
   * intervening edit/write to that path) triggers a "read-loop" detection.
   * Reads rarely fail, so this pattern does not require `isError`.
   */
  readLoopThreshold: number;
  /** How many recent entries to examine for read-loop patterns. */
  readLoopWindow: number;
  /**
   * Same toolName strictly alternating between exactly two signatures this
   * many times (e.g. A→B→A→B) in the examined window triggers an
   * "oscillation" detection — state-pendulum swings that succeed individually
   * but never converge.
   */
  oscillationThreshold: number;
  /** How many recent entries to examine for oscillation patterns. */
  oscillationWindow: number;
}

export const DEFAULT_CONFIG: DoomLoopConfig = {
  historySize: 30,
  identicalFailureThreshold: 2,
  identicalFailureWindow: 10,
  stuckToolThreshold: 3,
  stuckToolWindow: 8,
  readLoopThreshold: 3,
  readLoopWindow: 8,
  oscillationThreshold: 4,
  oscillationWindow: 8,
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
  /**
   * First text block of the tool result, truncated. Only used to match the
   * timeout pattern; never stored beyond a short prefix and never surfaced
   * verbatim in a detection message (keeps output limited per the issue's
   * "no full tool output" constraint).
   */
  errorTextPrefix?: string;
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
  const norm = (value: unknown): string =>
    String(value ?? "")
      .trim()
      .toLowerCase();

  switch (toolName) {
    case "edit":
      parts.push("e:" + norm(input.oldText));
      parts.push("p:" + norm(input.path ?? input.filePath ?? ""));
      break;
    case "write":
      parts.push(
        "p:" +
          norm(
            input.path ?? input.filePath ?? contentHash(norm(input.content)),
          ),
      );
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
  kind:
    | "identical-failure"
    | "stuck-tool"
    | "timeout"
    | "read-loop"
    | "oscillation"
    | "stale-test-failure";
  toolName: string;
  /** Human-readable explanation (for a status label or notification). */
  message: string;
  /** How many times the pattern was observed in the examined window. */
  occurrences: number;
  /** The normalised signature of the offending call, for capability-bus lookups. */
  signature: string;
}

const TIMEOUT_PATTERN = /timed out|timeout/i;

/** Extract the first text block from a tool_result's content, if any. */
function firstText(content: Array<{ type: string; text?: string }>): string {
  return content.find((c) => c.type === "text")?.text ?? "";
}

/**
 * All of edit/write/read signatures end in a `p:<path>` segment (see
 * normaliseSignature) — used by the read-loop check to tell whether a write
 * touched the same file a read keeps re-reading.
 */
function signaturePath(signature: string): string | undefined {
  const match = signature.match(/p:([^|]*)$/);
  return match ? match[1] : undefined;
}

/**
 * Match the current entry against recent history and return up to one
 * detection (first match wins, in order: timeout, stale-test-failure,
 * identical-failure, stuck-tool, read-loop, oscillation). Returns
 * `undefined` when no threshold is met.
 *
 * `editsSinceLastBashRun` is maintained by the caller (session-scoped state,
 * not derivable from a bounded history window alone) — see
 * `registerDoomLoopDetector`. It counts successful edit/write calls since
 * the previous `bash` call and resets to 0 on every `bash` call.
 */
export function detectLoop(
  entry: NormalisedEntry,
  history: NormalisedEntry[],
  config: DoomLoopConfig = DEFAULT_CONFIG,
  editsSinceLastBashRun = 0,
): LoopDetection | undefined {
  // Timeout: a hung/timed-out tool call is always worth surfacing, no
  // repetition threshold needed.
  if (
    entry.isError &&
    entry.errorTextPrefix &&
    TIMEOUT_PATTERN.test(entry.errorTextPrefix)
  ) {
    return {
      kind: "timeout",
      toolName: entry.toolName,
      message: `${entry.toolName}: Tool-Aufruf hat einen Timeout ausgelöst — möglicherweise hängender Prozess.`,
      occurrences: 1,
      signature: entry.signature,
    };
  }

  // Stale-test-failure: same bash command failed before, with zero
  // successful edit/write calls in between — re-running the same test
  // without having changed anything. More specific than identical-failure
  // (which doesn't check for an intervening code change), so it is checked
  // first for bash entries.
  if (
    entry.isError &&
    entry.toolName === "bash" &&
    editsSinceLastBashRun === 0
  ) {
    const window = history.slice(-config.identicalFailureWindow);
    const identicalBashFailures = window.filter(
      (e) =>
        e.isError && e.toolName === "bash" && e.signature === entry.signature,
    );
    if (identicalBashFailures.length >= config.identicalFailureThreshold) {
      return {
        kind: "stale-test-failure",
        toolName: "bash",
        message: `bash: derselbe Testfehler (${identicalBashFailures.length + 1}x) ohne Codeänderung dazwischen — Ursache analysieren statt erneut auszuführen.`,
        occurrences: identicalBashFailures.length + 1,
        signature: entry.signature,
      };
    }
  }

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
      const message =
        entry.toolName === "edit"
          ? `edit: Suchmuster wiederholt fehlgeschlagen (${identicalErrors.length + 1}x) — Datei erneut lesen statt zu raten.`
          : `${entry.toolName}: identischer fehlgeschlagener Aufruf (${identicalErrors.length + 1}x) — mögliche Doom-Loop.`;
      return {
        kind: "identical-failure",
        toolName: entry.toolName,
        message,
        occurrences: identicalErrors.length + 1,
        signature: entry.signature,
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
        signature: entry.signature,
      };
    }
  }

  // Read-loop: same path read repeatedly without an intervening edit/write
  // to that path. Reads rarely fail, so this does not require isError.
  if (entry.toolName === "read") {
    const window = history.slice(-config.readLoopWindow);
    const path = signaturePath(entry.signature);
    const sameReads = window.filter(
      (e) => e.toolName === "read" && e.signature === entry.signature,
    );
    const wasModified = window.some(
      (e) =>
        (e.toolName === "edit" || e.toolName === "write") &&
        path !== undefined &&
        signaturePath(e.signature) === path,
    );
    if (!wasModified && sameReads.length >= config.readLoopThreshold - 1) {
      return {
        kind: "read-loop",
        toolName: entry.toolName,
        message: `read: derselbe Pfad wiederholt gelesen (${sameReads.length + 1}x) ohne zwischenzeitliche Änderung — neue Begründung nötig.`,
        occurrences: sameReads.length + 1,
        signature: entry.signature,
      };
    }
  }

  // Oscillation: same toolName strictly alternating between exactly two
  // signatures (A→B→A→B→…) — a state pendulum where each individual call
  // may succeed, so this does not require isError. Not a special case of
  // identical-failure/stuck-tool (those require the SAME signature failing
  // repeatedly); this requires two DIFFERENT signatures never converging.
  {
    const window = history
      .filter((e) => e.toolName === entry.toolName)
      .slice(-(config.oscillationThreshold - 1));
    const sequence = [...window, entry];
    if (sequence.length >= config.oscillationThreshold) {
      const signatures = new Set(sequence.map((e) => e.signature));
      const alternates =
        signatures.size === 2 &&
        sequence.every(
          (e, i) => i < 2 || e.signature === sequence[i - 2].signature,
        );
      if (alternates) {
        return {
          kind: "oscillation",
          toolName: entry.toolName,
          message: `${entry.toolName}: pendelt zwischen zwei Zuständen (${sequence.length}x) ohne Konvergenz — neue Strategie nötig.`,
          occurrences: sequence.length,
          signature: entry.signature,
        };
      }
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
  /**
   * Successful edit/write calls since the last `bash` call; reset to 0 on
   * every `bash` call. Feeds the `stale-test-failure` pattern (a repeated
   * bash failure with zero code changes in between).
   */
  editsSinceLastBashRun: number;
}

export function createDoomLoopState(
  config?: Partial<DoomLoopConfig>,
): DoomLoopState {
  const resolved = { ...DEFAULT_CONFIG, ...config };
  return {
    history: new HistoryBuffer(resolved.historySize),
    config: resolved,
    editsSinceLastBashRun: 0,
  };
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
      // Only a short prefix, only to match the timeout pattern — never
      // stored or surfaced in full (per the issue's output constraint).
      ...(event.isError
        ? { errorTextPrefix: firstText(event.content).slice(0, 200) }
        : {}),
    };
    state.history.push(entry);
    // Read-loop and oscillation are the only patterns that can trigger on a
    // successful call, so detectLoop always runs; error-only patterns
    // (timeout/stale-test-failure/identical-failure/stuck-tool) return
    // undefined by construction when entry.isError is false.
    const detection = detectLoop(
      entry,
      state.history.tail(
        Math.max(
          state.config.identicalFailureWindow,
          state.config.readLoopWindow,
          state.config.oscillationWindow,
        ) * 2,
      ),
      state.config,
      state.editsSinceLastBashRun,
    );
    // Update the edits-since-bash counter AFTER detection (which needs the
    // value as of the previous bash run), so this call itself is reflected
    // starting with the next entry.
    if (entry.toolName === "bash") {
      state.editsSinceLastBashRun = 0;
    } else if (
      !entry.isError &&
      (entry.toolName === "edit" || entry.toolName === "write")
    ) {
      state.editsSinceLastBashRun += 1;
    }
    if (detection) {
      state.lastDetection = detection;
      // Advisory: publish a label visible in the Aurora footer so both
      // the agent and the user can see the warning.
      pi.appendEntry("doom-loop", detection);
    } else if (entry.isError === false) {
      // A successful, non-looping result breaks the loop perception.
      state.lastDetection = undefined;
    }
  });

  pi.events.on(DOOM_LOOP_CAPABILITY_EVENTS.request, (busEvent) => {
    const request = busEvent as DoomLoopCapabilityRequest;
    const detection = state.lastDetection;
    request.respond(
      detection
        ? {
            active: true,
            reason: detection.message,
            signature: detection.signature,
            toolName: detection.toolName,
          }
        : { active: false },
    );
  });

  pi.on("session_shutdown", () => {
    state.history.clear();
    state.lastDetection = undefined;
    state.editsSinceLastBashRun = 0;
  });

  return state;
}
