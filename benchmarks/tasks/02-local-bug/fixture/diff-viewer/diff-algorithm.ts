/** Myers-Diff für Zeilen sowie begrenzte Inline-Word-Diffs. */
import type { DiffHunk, DiffLine, InlineSegment } from "./types.ts";

type EditOp = "keep" | "insert" | "delete";

const MAX_LINES = 10_000;
const MAX_BYTES = 50_000;
const MAX_MYERS_LENGTH = 4_000;
const MAX_INLINE_TOKENS = 512;
const MAX_INLINE_MATRIX_CELLS = 65_536;

export function computeLineDiff(oldLines: string[], newLines: string[]): EditOp[] {
  const size = oldLines.join("\n").length + newLines.join("\n").length;
  if (
    oldLines.length > MAX_LINES || newLines.length > MAX_LINES ||
    oldLines.length + newLines.length > MAX_MYERS_LENGTH || size > MAX_BYTES
  ) {
    return [...oldLines.map(() => "delete" as const), ...newLines.map(() => "insert" as const)];
  }
  return myers(oldLines, newLines);
}

function myers(a: string[], b: string[]): EditOp[] {
  const max = a.length + b.length;
  const trace: Array<Map<number, number>> = [];
  const v = new Map<number, number>([[1, 0]]);

  for (let d = 0; d <= max; d++) {
    // Snapshot des vorherigen D-Schritts für die Rückwärtsrekonstruktion.
    trace.push(new Map(v));
    for (let k = -d; k <= d; k += 2) {
      const down = k === -d || (k !== d && (v.get(k - 1) ?? -1) < (v.get(k + 1) ?? -1));
      let x = down ? (v.get(k + 1) ?? 0) : (v.get(k - 1) ?? 0) + 1;
      let y = x - k;
      while (x < a.length && y < b.length && a[x] === b[y]) {
        x++;
        y++;
      }
      v.set(k, x);
      if (x >= a.length && y >= b.length) return reconstruct(a, b, trace);
    }
  }
  return [...a.map(() => "delete" as const), ...b.map(() => "insert" as const)];
}

function reconstruct(a: string[], b: string[], trace: Array<Map<number, number>>): EditOp[] {
  const reversed: EditOp[] = [];
  let x = a.length;
  let y = b.length;
  for (let d = trace.length - 1; d > 0; d--) {
    const v = trace[d]!;
    const k = x - y;
    const down = k === -d || (k !== d && (v.get(k - 1) ?? -1) < (v.get(k + 1) ?? -1));
    const previousK = down ? k + 1 : k - 1;
    const previousX = v.get(previousK) ?? 0;
    const previousY = previousX - previousK;
    while (x > previousX && y > previousY) {
      reversed.push("keep");
      x--;
      y--;
    }
    reversed.push(down ? "insert" : "delete");
    if (down) y--; else x--;
  }
  while (x > 0 && y > 0) {
    reversed.push("keep");
    x--; y--;
  }
  while (x-- > 0) reversed.push("delete");
  while (y-- > 0) reversed.push("insert");
  return reversed.reverse();
}

interface ScriptStep {
  op: EditOp;
  oldLine?: number;
  newLine?: number;
  text: string;
}

/** Konvertiert ein Edit-Script in getrennte Unified-Diff-Hunks. */
export function scriptToHunks(
  oldLines: string[],
  newLines: string[],
  script: EditOp[],
  contextLines = 3,
): DiffHunk[] {
  const steps = buildSteps(oldLines, newLines, script);
  const changed = steps.flatMap((step, index) => step.op === "keep" ? [] : [index]);
  if (changed.length === 0) return [];

  const ranges: Array<[number, number]> = [];
  let first = changed[0]!;
  let last = first;
  for (const index of changed.slice(1)) {
    // Context überlappt nur, wenn zwischen den Änderungen höchstens 2*context Zeilen liegen.
    if (index - last < contextLines * 2 + 1) {
      last = index;
    } else {
      ranges.push([Math.max(0, first - contextLines), Math.min(steps.length - 1, last + contextLines)]);
      first = index;
      last = index;
    }
  }
  ranges.push([Math.max(0, first - contextLines), Math.min(steps.length - 1, last + contextLines)]);

  return ranges.map(([start, end]) => {
    const selected = steps.slice(start, end + 1);
    const lines: DiffLine[] = selected.map((step) => {
      if (step.op === "keep") {
        return { kind: "context", oldLine: step.oldLine, newLine: step.newLine, text: step.text };
      }
      if (step.op === "delete") {
        return { kind: "removed", oldLine: step.oldLine, text: step.text };
      }
      return { kind: "added", newLine: step.newLine, text: step.text };
    });
    addInlineHighlights(lines);
    return {
      oldStart: selected.find((step) => step.oldLine !== undefined)?.oldLine ?? 0,
      oldCount: lines.filter((line) => line.kind !== "added").length,
      newStart: selected.find((step) => step.newLine !== undefined)?.newLine ?? 0,
      newCount: lines.filter((line) => line.kind !== "removed").length,
      lines,
    };
  });
}

function buildSteps(oldLines: string[], newLines: string[], script: EditOp[]): ScriptStep[] {
  const steps: ScriptStep[] = [];
  let oldIndex = 0;
  let newIndex = 0;
  for (const op of script) {
    if (op === "keep") {
      steps.push({ op, oldLine: oldIndex + 1, newLine: newIndex + 1, text: oldLines[oldIndex] ?? "" });
      oldIndex++;
      newIndex++;
    } else if (op === "delete") {
      steps.push({ op, oldLine: oldIndex + 1, text: oldLines[oldIndex] ?? "" });
      oldIndex++;
    } else {
      steps.push({ op, newLine: newIndex + 1, text: newLines[newIndex] ?? "" });
      newIndex++;
    }
  }
  return steps;
}

/** Berechnet Word-Level-Diffs, ohne unbeschränkt quadratischen Speicher zu verwenden. */
export function computeWordDiff(oldText: string, newText: string): InlineSegment[] {
  if (oldText === newText) return [{ type: "equal", text: oldText }];
  if (!oldText) return [{ type: "added", text: newText }];
  if (!newText) return [{ type: "removed", text: oldText }];

  const oldTokens = tokenize(oldText);
  const newTokens = tokenize(newText);
  if (
    oldTokens.length + newTokens.length > MAX_INLINE_TOKENS ||
    oldTokens.length * newTokens.length > MAX_INLINE_MATRIX_CELLS
  ) {
    // Sicherer Fallback: Zeilenfarbe bleibt sichtbar, nur kein Wort-Level-Highlight.
    return [];
  }

  const matches = computeLCS(oldTokens, newTokens);
  const segments: InlineSegment[] = [];
  let oldIndex = 0;
  let newIndex = 0;
  for (const [oldMatch, newMatch] of matches) {
    if (oldIndex < oldMatch) segments.push({ type: "removed", text: oldTokens.slice(oldIndex, oldMatch).join("") });
    if (newIndex < newMatch) segments.push({ type: "added", text: newTokens.slice(newIndex, newMatch).join("") });
    segments.push({ type: "equal", text: oldTokens[oldMatch]! });
    oldIndex = oldMatch + 1;
    newIndex = newMatch + 1;
  }
  if (oldIndex < oldTokens.length) segments.push({ type: "removed", text: oldTokens.slice(oldIndex).join("") });
  if (newIndex < newTokens.length) segments.push({ type: "added", text: newTokens.slice(newIndex).join("") });
  return mergeSegments(segments);
}

function addInlineHighlights(lines: DiffLine[]): void {
  for (let index = 0; index < lines.length - 1; index++) {
    const removed = lines[index]!;
    const added = lines[index + 1]!;
    if (removed.kind === "removed" && added.kind === "added") {
      const highlights = computeWordDiff(removed.text, added.text);
      if (highlights.length > 0) {
        removed.highlights = highlights;
        added.highlights = highlights;
      }
    }
  }
}

function tokenize(text: string): string[] {
  return text.match(/\s+|\w+|[^\s\w]/g) ?? [];
}

function computeLCS(a: string[], b: string[]): Array<[number, number]> {
  const table: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      table[i]![j] = a[i - 1] === b[j - 1]
        ? table[i - 1]![j - 1]! + 1
        : Math.max(table[i - 1]![j]!, table[i]![j - 1]!);
    }
  }
  const matches: Array<[number, number]> = [];
  for (let i = a.length, j = b.length; i > 0 && j > 0;) {
    if (a[i - 1] === b[j - 1]) {
      matches.unshift([i - 1, j - 1]);
      i--; j--;
    } else if (table[i - 1]![j]! >= table[i]![j - 1]!) i--;
    else j--;
  }
  return matches;
}

function mergeSegments(segments: InlineSegment[]): InlineSegment[] {
  const merged: InlineSegment[] = [];
  for (const segment of segments) {
    const last = merged[merged.length - 1];
    if (last?.type === segment.type) last.text += segment.text;
    else if (segment.text) merged.push({ ...segment });
  }
  return merged;
}
