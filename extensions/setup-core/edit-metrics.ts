/**
 * Session-scoped edit and write metrics for issue #104.
 *
 * Hooks `tool_call` and `tool_result` for the `edit` and `write` tools and
 * tracks per-session counters that help diagnose repeated edit failures, large
 * file rewrites, and edit-vs-write ratio — both for human review and as a
 * companion to the doom-loop detector (#103).
 *
 * The fallback hierarchy described in the issue (precise edit → re-read →
 * refine once → larger patch → full write for small files only) is an agent
 * *behaviour* guideline, not automated code. This module provides the
 * *observability*: what actually happened.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PerFileStats {
  path: string;
  editAttempts: number;
  editFailures: number;
  writeCalls: number;
}

export interface EditMetrics {
  /** Total edit tool calls this session. */
  editAttempts: number;
  /** Edit calls whose tool_result had isError: true. */
  editFailures: number;
  /** Total write tool calls this session. */
  writeCalls: number;
  /** Write calls where the target path already existed (not a new file). */
  writeToExisting: number;
  /** Per-file breakdown, keyed by normalised path. */
  perFile: Record<string, PerFileStats>;
}

// ---------------------------------------------------------------------------
// Tracker
// ---------------------------------------------------------------------------

/** Normalise a path-like input value for stable per-file keys. */
function normalisePathKey(value: unknown): string {
  const s = String(value ?? "").trim().replace(/\\/g, "/");
  while (s.startsWith("./")) return s.slice(2);
  return s || "(unknown)";
}

function ensurePerFile(m: EditMetrics, path: string): PerFileStats {
  const key = normalisePathKey(path);
  let entry = m.perFile[key];
  if (!entry) {
    entry = { path: key, editAttempts: 0, editFailures: 0, writeCalls: 0 };
    m.perFile[key] = entry;
  }
  return entry;
}

export function createEditMetrics(): EditMetrics {
  return { editAttempts: 0, editFailures: 0, writeCalls: 0, writeToExisting: 0, perFile: {} };
}

/**
 * Register edit-metrics hooks on the supplied extension API. Returns a
 * live metrics object; the caller owns it and can query it at any time.
 */
export function registerEditMetrics(
  pi: ExtensionAPI,
  metrics: EditMetrics = createEditMetrics(),
  options: { existCheck?: (path: string) => boolean } = {},
): EditMetrics {
  // Track edit/write *calls*.
  pi.on("tool_call", (event) => {
    const input = (event as { input?: Record<string, unknown> }).input ?? {};
    if (event.toolName === "edit") {
      metrics.editAttempts++;
      const p = input.path ?? input.filePath ?? "";
      ensurePerFile(metrics, String(p)).editAttempts++;
    } else if (event.toolName === "write") {
      metrics.writeCalls++;
      const p = input.path ?? input.filePath ?? "";
      const entry = ensurePerFile(metrics, String(p));
      entry.writeCalls++;
      if (options.existCheck?.(String(p)) === true) metrics.writeToExisting++;
    }
  });

  // Track edit *results*.
  pi.on("tool_result", (event) => {
    const input = (event as { input?: Record<string, unknown> }).input ?? {};
    if (event.toolName === "edit" && event.isError) {
      metrics.editFailures++;
      const p = input.path ?? input.filePath ?? "";
      ensurePerFile(metrics, String(p)).editFailures++;
    }
  });

  // Clear on session shutdown.
  pi.on("session_shutdown", () => {
    metrics.editAttempts = 0;
    metrics.editFailures = 0;
    metrics.writeCalls = 0;
    metrics.writeToExisting = 0;
    metrics.perFile = {};
  });

  return metrics;
}

/**
 * Return a short one-line summary suitable for a status label (e.g. a
 * `/setup-doctor` line).
 */
export function metricsSummary(m: EditMetrics): string {
  const editRatio = m.editAttempts > 0
    ? `${Math.round((m.editFailures / m.editAttempts) * 100)}%`
    : "–";
  const writeHint = m.writeToExisting > 0
    ? ` (${m.writeToExisting} auf vorhandene Dateien)`
    : "";
  const topFiles = Object.values(m.perFile)
    .filter((f) => f.editFailures > 0)
    .sort((a, b) => b.editFailures - a.editFailures)
    .slice(0, 3);
  const filePart = topFiles.length > 0
    ? ` — Top-Fehlerdateien: ${topFiles.map((f) => `${f.path}(${f.editFailures})`).join(", ")}`
    : "";
  return `edits ${m.editAttempts}/${m.editFailures} Fehler (${editRatio}), writes ${m.writeCalls}${writeHint}${filePart}`;
}
