/**
 * Diff-Renderer: Konvertiert strukturierte Diff-Daten in farbige ANSI-Ausgabe.
 * Unterstützt Compact- und Full-Modi.
 */
import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { DiffHunk, DiffStats, FileDiff } from "./types.ts";

/** Maximale Anzahl Hunk-Zeilen im Compact-Modus. */
const COMPACT_MAX_LINES = 6;

/** Breite des Zeilennummern-Feldes. */
const LINE_NUM_WIDTH = 5;

// ---------------------------------------------------------------------------
// Rendering-Funktionen
// ---------------------------------------------------------------------------

/**
 * Rendert den Compact-Modus: 1 Statistik-Zeile + wenige Hunk-Vorschauzeilen.
 */
export function renderCompact(
  diff: FileDiff,
  theme: Theme,
  width: number,
): string[] {
  const lines: string[] = [];
  const stats = diff.stats;

  // Statistik-Zeile
  lines.push(renderStatLine(stats, theme, width));

  // Erste Hunks (max COMPACT_MAX_LINES Zeilen)
  let rendered = 0;
  for (const hunk of diff.hunks) {
    if (rendered >= COMPACT_MAX_LINES) break;

    // Hunk-Header
    if (rendered > 0) lines.push(theme.fg("dim", "  …"));
    if (rendered >= COMPACT_MAX_LINES) break;

    const header = renderHunkHeader(hunk, theme);
    if (rendered + 1 <= COMPACT_MAX_LINES) {
      lines.push(truncate(header, width));
      rendered++;
    }

    // Hunk-Zeilen
    for (const dl of hunk.lines) {
      if (rendered >= COMPACT_MAX_LINES) break;
      lines.push(truncate(renderDiffLine(dl, theme, false), width));
      rendered++;
    }
  }

  if (rendered >= COMPACT_MAX_LINES && totalDiffLines(diff) > COMPACT_MAX_LINES) {
    const remaining = totalDiffLines(diff) - COMPACT_MAX_LINES;
    lines.push(theme.fg("dim", `  … ${remaining} weitere Zeilen`));
  }

  return lines;
}

/**
 * Rendert den Full-Modus: Vollständiger Diff mit Zeilennummern.
 */
export function renderFull(
  diff: FileDiff,
  theme: Theme,
  width: number,
): string[] {
  const lines: string[] = [];
  const stats = diff.stats;

  // Header
  lines.push(renderStatLine(stats, theme, width));

  for (const hunk of diff.hunks) {
    lines.push(truncate(renderHunkHeader(hunk, theme), width));
    for (const dl of hunk.lines) {
      lines.push(truncate(renderDiffLine(dl, theme, true), width));
    }
  }

  return lines;
}

/**
 * Rendert die Statistik-Zeile: "📄 path/to/file  +N −M  (K Hunks)"
 */
export function renderStatLine(
  stats: DiffStats,
  theme: Theme,
  _width: number,
): string {
  const parts: string[] = [];
  parts.push(theme.fg("accent", `📄 ${stats.path}`));
  parts.push("  ");
  if (stats.linesAdded > 0) {
    parts.push(theme.fg("toolDiffAdded", `+${stats.linesAdded}`));
  }
  if (stats.linesAdded > 0 && stats.linesRemoved > 0) parts.push(" ");
  if (stats.linesRemoved > 0) {
    parts.push(theme.fg("toolDiffRemoved", `−${stats.linesRemoved}`));
  }
  if (stats.hunks > 1) {
    parts.push(theme.fg("dim", `  (${stats.hunks} Hunks)`));
  }
  return parts.join("");
}

/**
 * Rendert den Hunk-Header: "@@ -oldStart,oldCount +newStart,newCount @@ heading"
 */
function renderHunkHeader(hunk: DiffHunk, theme: Theme): string {
  let header = theme.fg("accent", "@@");
  header += theme.fg("toolDiffRemoved", ` -${hunk.oldStart},${hunk.oldCount}`);
  header += theme.fg("toolDiffAdded", ` +${hunk.newStart},${hunk.newCount}`);
  header += theme.fg("accent", " @@");
  if (hunk.heading) {
    header += theme.fg("dim", ` ${hunk.heading}`);
  }
  return `  ${header}`;
}

/**
 * Rendert eine einzelne Diff-Zeile mit Farben und optionalen Zeilennummern.
 */
function renderDiffLine(
  dl: import("./types.ts").DiffLine,
  theme: Theme,
  showLineNums: boolean,
): string {
  let prefix = "";
  let content = "";
  let fg: (s: string) => string;
  let inlineStyled = false;

  switch (dl.kind) {
    case "added": {
      prefix = "+";
      fg = (s) => theme.fg("toolDiffAdded", s);
      content = renderInlineLine(dl.text, dl.highlights, "added", theme);
      inlineStyled = content !== dl.text;
      break;
    }
    case "removed": {
      prefix = "−";
      fg = (s) => theme.fg("toolDiffRemoved", s);
      content = renderInlineLine(dl.text, dl.highlights, "removed", theme);
      inlineStyled = content !== dl.text;
      break;
    }
    case "context": {
      prefix = " ";
      fg = (s) => theme.fg("toolDiffContext", s);
      content = dl.text;
      break;
    }
  }

  // Zeilennummern
  let numPart = "";
  if (showLineNums) {
    const oldNum = dl.oldLine !== undefined ? padNum(dl.oldLine) : " ".repeat(LINE_NUM_WIDTH);
    const newNum = dl.newLine !== undefined ? padNum(dl.newLine) : " ".repeat(LINE_NUM_WIDTH);
    numPart = theme.fg("dim", `${oldNum} ${newNum} `);
  }

  const prefixColor =
    dl.kind === "added" ? theme.fg("toolDiffAdded", prefix) :
    dl.kind === "removed" ? theme.fg("toolDiffRemoved", prefix) :
    theme.fg("dim", prefix);

  return `  ${prefixColor} ${numPart}${inlineStyled ? content : fg(content)}`;
}

/**
 * Rendert Zeileninhalt mit Inline-Highlights (Word-Level-Diff).
 */
function renderInlineLine(
  text: string,
  highlights: import("./types.ts").InlineSegment[] | undefined,
  lineKind: "added" | "removed",
  theme: Theme,
): string {
  if (!highlights || highlights.length === 0) return text;

  // Die gemeinsame Segmentliste enthält alten und neuen Text. Jede Diff-Zeile
  // zeigt nur ihre eigene Richtung; geänderte Wörter sind gelb hervorgehoben.
  let result = "";
  for (const segment of highlights) {
    if (segment.type === "equal") {
      result += lineKind === "added"
        ? theme.fg("toolDiffAdded", segment.text)
        : theme.fg("toolDiffRemoved", segment.text);
    } else if (segment.type === lineKind) {
      result += theme.fg("warning", theme.bold(segment.text));
    }
  }
  return result || text;
}

// ---------------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------------

function totalDiffLines(diff: FileDiff): number {
  let count = 0;
  for (const hunk of diff.hunks) {
    count++; // Hunk-Header
    count += hunk.lines.length;
  }
  return count;
}

function padNum(n: number): string {
  const s = String(n);
  return s.length >= LINE_NUM_WIDTH ? s : " ".repeat(LINE_NUM_WIDTH - s.length) + s;
}

function truncate(s: string, width: number): string {
  return truncateToWidth(s, Math.max(1, width), "…");
}
