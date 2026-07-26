/**
 * In-memory fallback diff for the active write/change tracker.
 *
 * The previous Git subprocess helpers had no runtime callers. Keeping the
 * fallback independent avoids a second diff parser and duplicate inline logic.
 */
import type { FileDiff } from "./types.ts";
import { computeLineDiff, scriptToHunks } from "./diff-algorithm.ts";

/** Berechnet Diff durch direkten Vergleich zweier Dateiinhalte. */
export function computeFallbackDiff(
  filePath: string,
  oldContent: string,
  newContent: string,
): FileDiff {
  const oldLines = splitContentLines(oldContent);
  const newLines = splitContentLines(newContent);

  const script = computeLineDiff(oldLines, newLines);
  const hunks = scriptToHunks(oldLines, newLines, script);

  const linesAdded = script.filter((s) => s === "insert").length;
  const linesRemoved = script.filter((s) => s === "delete").length;

  return {
    stats: { path: filePath, linesAdded, linesRemoved, hunks: hunks.length },
    hunks,
    timestamp: Date.now(),
  };
}

/** Zerlegt Textzeilen ohne die künstliche Leerzeile eines finalen LF. */
export function splitContentLines(content: string): string[] {
  if (!content) return [];
  const lines = content.split("\n");
  if (content.endsWith("\n")) lines.pop();
  return lines;
}
