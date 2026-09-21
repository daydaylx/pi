import type { DiffHunk, DiffStats } from "../diff-viewer/types.ts";

/** Read-only event emitted after the diff viewer records a real edit/write change. */
export const DIFF_VIEWER_CHANGE_EVENT = "diff-viewer.change" as const;

export interface DiffViewerChangeEvent {
  path: string;
  toolName: string;
  timestamp: number;
  stats: DiffStats;
  hunks: DiffHunk[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Runtime guard for the untyped shared extension event bus. */
export function isDiffViewerChangeEvent(
  value: unknown,
): value is DiffViewerChangeEvent {
  if (!isRecord(value)) return false;
  const stats = value.stats;
  const hunks = value.hunks;
  return (
    typeof value.path === "string" &&
    typeof value.toolName === "string" &&
    Number.isFinite(value.timestamp) &&
    isRecord(stats) &&
    typeof stats.path === "string" &&
    Number.isInteger(stats.linesAdded) &&
    Number.isInteger(stats.linesRemoved) &&
    Number.isInteger(stats.hunks) &&
    Array.isArray(hunks) &&
    hunks.every(
      (hunk) =>
        isRecord(hunk) &&
        Array.isArray(hunk.lines) &&
        hunk.lines.every((line) => isRecord(line)),
    )
  );
}
