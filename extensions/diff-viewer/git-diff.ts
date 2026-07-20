/**
 * Git-Diff-Integration und Fallback-Diff.
 * Führt `git diff` aus und parst die Ausgabe, oder fällt auf Myers-Diff zurück.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { DiffHunk, DiffLine, DiffStats, FileDiff } from "./types.ts";
import { computeLineDiff, scriptToHunks, computeWordDiff } from "./diff-algorithm.ts";

// ---------------------------------------------------------------------------
// Git-Verfügbarkeit
// ---------------------------------------------------------------------------

/** Gecachte Git-Verfügbarkeit für die Session. */
let _gitAvailableCache: { cwd: string; available: boolean } | null = null;

/** Prüft, ob Git im aktuellen Verzeichnis verfügbar ist (mit Cache). */
export async function isGitAvailable(
  pi: ExtensionAPI,
  cwd: string,
): Promise<boolean> {
  if (_gitAvailableCache?.cwd === cwd) {
    return _gitAvailableCache.available;
  }
  try {
    const result = await pi.exec("git", ["rev-parse", "--git-dir"], {
      cwd,
      timeout: 5000,
    });
    const available = result.code === 0 && result.stdout.trim().length > 0;
    _gitAvailableCache = { cwd, available };
    return available;
  } catch {
    _gitAvailableCache = { cwd, available: false };
    return false;
  }
}

// ---------------------------------------------------------------------------
// Git-Diff-APIs
// ---------------------------------------------------------------------------

/** Führt `git diff` für eine Datei aus und parst die Ausgabe. */
export async function gitDiffForFile(
  pi: ExtensionAPI,
  cwd: string,
  filePath: string,
): Promise<FileDiff | null> {
  try {
    const result = await pi.exec(
      "git",
      ["diff", "--no-color", "--unified=3", "--", filePath],
      { cwd, timeout: 10000 },
    );
    if (result.code !== 0 || !result.stdout.trim()) return null;
    return parseUnifiedDiff(filePath, result.stdout);
  } catch {
    return null;
  }
}

/** Führt `git diff` für alle geänderten Dateien aus. */
export async function gitDiffAll(
  pi: ExtensionAPI,
  cwd: string,
): Promise<FileDiff[]> {
  try {
    const result = await pi.exec(
      "git",
      ["diff", "--no-color", "--unified=3"],
      { cwd, timeout: 15000 },
    );
    if (result.code !== 0 || !result.stdout.trim()) return [];
    return parseMultiFileDiff(result.stdout);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Fallback: Vorher-/Nachher-Vergleich ohne Git
// ---------------------------------------------------------------------------

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

  // Word-Level-Diff für added/removed-Paare
  for (const hunk of hunks) {
    addInlineHighlights(hunk);
  }

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

// ---------------------------------------------------------------------------
// Unified-Diff-Parser
// ---------------------------------------------------------------------------

function parseUnifiedDiff(filePath: string, raw: string): FileDiff {
  const lines = raw.split("\n");
  const hunks: DiffHunk[] = [];
  let currentHunk: DiffHunk | null = null;
  let linesAdded = 0;
  let linesRemoved = 0;

  const hunkHeaderRe = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

  for (const line of lines) {
    const hunkMatch = line.match(hunkHeaderRe);
    if (hunkMatch) {
      if (currentHunk && currentHunk.lines.length > 0) hunks.push(currentHunk);
      currentHunk = {
        oldStart: parseInt(hunkMatch[1]!, 10),
        oldCount: hunkMatch[2] ? parseInt(hunkMatch[2], 10) : 1,
        newStart: parseInt(hunkMatch[3]!, 10),
        newCount: hunkMatch[4] ? parseInt(hunkMatch[4], 10) : 1,
        heading: (hunkMatch[5] ?? "").trim() || undefined,
        lines: [],
      };
      continue;
    }
    if (!currentHunk) continue;

    // Zeilennummern vorberechnen
    const oldLineNum = currentHunk.oldStart +
      currentHunk.lines.filter((l) => l.kind !== "added").length;
    const newLineNum = currentHunk.newStart +
      currentHunk.lines.filter((l) => l.kind !== "removed").length;

    if (line.startsWith("+") && !line.startsWith("+++")) {
      currentHunk.lines.push({ kind: "added", newLine: newLineNum, text: line.slice(1) });
      linesAdded++;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      currentHunk.lines.push({ kind: "removed", oldLine: oldLineNum, text: line.slice(1) });
      linesRemoved++;
    } else if (line.startsWith(" ") || line === "") {
      currentHunk.lines.push({
        kind: "context",
        oldLine: oldLineNum,
        newLine: newLineNum,
        text: line.startsWith(" ") ? line.slice(1) : line,
      });
    }
  }

  if (currentHunk && currentHunk.lines.length > 0) hunks.push(currentHunk);

  // Word-Level-Diff für added/removed-Paare
  for (const hunk of hunks) {
    addInlineHighlights(hunk);
  }

  return {
    stats: { path: filePath, linesAdded, linesRemoved, hunks: hunks.length },
    hunks,
    timestamp: Date.now(),
    raw,
  };
}

function parseMultiFileDiff(raw: string): FileDiff[] {
  const diffs: FileDiff[] = [];
  const fileHeaderRe = /^diff --git a\/(.+) b\/(.+)$/;
  let currentPath: string | null = null;
  let currentRaw = "";

  for (const line of raw.split("\n")) {
    const match = line.match(fileHeaderRe);
    if (match) {
      if (currentPath && currentRaw.trim()) {
        diffs.push(parseUnifiedDiff(currentPath, currentRaw));
      }
      currentPath = match[2] ?? match[1] ?? "unknown";
      currentRaw = line + "\n";
    } else if (currentPath) {
      currentRaw += line + "\n";
    }
  }

  if (currentPath && currentRaw.trim()) {
    diffs.push(parseUnifiedDiff(currentPath, currentRaw));
  }

  return diffs;
}

// ---------------------------------------------------------------------------
// Word-Level-Highlights
// ---------------------------------------------------------------------------

/**
 * Ergänzt Word-Level-Highlights für added/removed-Paare in einem Hunk.
 */
function addInlineHighlights(hunk: DiffHunk): void {
  for (let i = 0; i < hunk.lines.length - 1; i++) {
    const current = hunk.lines[i]!;
    const next = hunk.lines[i + 1]!;

    if (current.kind === "removed" && next.kind === "added") {
      const highlights = computeWordDiff(current.text, next.text);
      current.highlights = highlights;
      next.highlights = highlights;
    }
  }
}
