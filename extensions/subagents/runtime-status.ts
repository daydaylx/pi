/**
 * Render-neutral runtime state for subagent execution.
 *
 * The former widget mixed process lifecycle, rendering preferences and a
 * global TUI component. This module deliberately stores only bounded runtime
 * facts; the caller decides when and where to publish the compact Zentui
 * status value.
 */

const MAX_TERMINAL_ENTRIES = 24;

export type SubagentRuntimeState =
  | "idle"
  | "queued"
  | "waiting"
  | "running"
  | "completed"
  | "warning"
  | "failed"
  | "blocked";

export const SUBAGENT_STATUS_SYMBOL: Record<SubagentRuntimeState, string> = {
  idle: "○",
  queued: "○",
  waiting: "○",
  running: "●",
  completed: "✓",
  warning: "!",
  failed: "✕",
  blocked: "⏸",
};

export const SUBAGENT_STATUS_LABEL: Record<SubagentRuntimeState, string> = {
  idle: "inaktiv",
  queued: "eingeplant",
  waiting: "wartet",
  running: "läuft",
  completed: "abgeschlossen",
  warning: "Warnung",
  failed: "fehlgeschlagen",
  blocked: "blockiert",
};

export interface SubagentRuntimeEntry {
  id: string;
  label: string;
  status: SubagentRuntimeState;
  currentTask: string;
  lastUpdate?: number;
  lastAction?: string;
  warnings?: number;
  errors?: number;
  startedAt?: number;
  completedAt?: number;
  relatedToolCalls?: string[];
  risk?: string;
}

function isActive(status: SubagentRuntimeState): boolean {
  return status === "queued" || status === "waiting" || status === "running";
}

function isTerminal(status: SubagentRuntimeState): boolean {
  return !isActive(status) && status !== "idle";
}

/** Returns the only permanent presentation contract for subagent activity. */
export function subagentStatusValue(
  entries: Iterable<SubagentRuntimeEntry>,
): string | undefined {
  let active = 0;
  let hasError = false;
  for (const entry of entries) {
    if (
      entry.status === "failed" ||
      entry.status === "blocked" ||
      (entry.errors ?? 0) > 0
    ) {
      hasError = true;
    }
    if (isActive(entry.status)) active += 1;
  }
  if (hasError) return "SUB ERR";
  return active > 0 ? `SUB ${active}` : undefined;
}

export class SubagentRuntimeStatus {
  private readonly entriesById = new Map<string, SubagentRuntimeEntry>();

  reset(): void {
    this.entriesById.clear();
  }

  entries(): readonly SubagentRuntimeEntry[] {
    return Array.from(this.entriesById.values());
  }

  statusValue(): string | undefined {
    return subagentStatusValue(this.entriesById.values());
  }

  upsert(entry: SubagentRuntimeEntry): void {
    const now = Date.now();
    const existing = this.entriesById.get(entry.id);
    const hasActiveRun = Array.from(this.entriesById.values()).some((item) =>
      isActive(item.status),
    );
    // A newly started batch supersedes terminal notices from an earlier
    // invocation. Parallel siblings see the active first run and therefore
    // retain each other's state.
    if (isActive(entry.status) && !hasActiveRun) {
      for (const [id, candidate] of this.entriesById) {
        if (isTerminal(candidate.status)) this.entriesById.delete(id);
      }
    }
    this.entriesById.set(entry.id, {
      ...existing,
      ...entry,
      startedAt:
        entry.startedAt ??
        existing?.startedAt ??
        (isActive(entry.status) ? now : undefined),
      lastUpdate: now,
    });
    this.pruneTerminalEntries();
  }

  private pruneTerminalEntries(): void {
    const terminal = Array.from(this.entriesById.values())
      .filter((entry) => isTerminal(entry.status))
      .sort((left, right) => (left.lastUpdate ?? 0) - (right.lastUpdate ?? 0));
    const excess = Math.max(0, terminal.length - MAX_TERMINAL_ENTRIES);
    for (const entry of terminal.slice(0, excess)) {
      this.entriesById.delete(entry.id);
    }
  }
}

/** Tracks only abort callbacks, so session shutdown can clean up child timers
 * and processes without retaining an ExtensionContext. */
export class SubagentRunLifecycle {
  private readonly aborters = new Set<() => void>();

  register(abort: () => void): () => void {
    this.aborters.add(abort);
    return () => this.aborters.delete(abort);
  }

  abortAll(): void {
    for (const abort of this.aborters) {
      try {
        abort();
      } catch {
        // Cleanup must not leave remaining child processes alive.
      }
    }
    this.aborters.clear();
  }
}
