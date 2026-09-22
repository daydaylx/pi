import { createHash } from "node:crypto";
import type { DiffHunk, DiffLine } from "../diff-viewer/types.ts";
import type { DiffViewerChangeEvent } from "../shared/diff-events.ts";
import type { LearningCandidate, LearningConcept } from "./types.ts";

const MAX_HUNK_LINES = 32;
const MAX_CHANGED_LINES = 14;
const MAX_HUNK_TEXT = 6_000;

const CONCEPT_PRIORITY: readonly LearningConcept[] = [
  "permission-change",
  "guard-removal",
  "test-expectation",
  "validation",
  "throw",
  "try-catch",
  "return",
  "condition-and",
  "condition-or",
  "negation",
  "fallback",
  "condition-if",
  "diff-basics",
];

const CONCEPT_VALUE: Record<LearningConcept, number> = {
  "diff-basics": 1,
  "condition-if": 4,
  "condition-and": 6,
  "condition-or": 6,
  negation: 6,
  return: 5,
  throw: 8,
  "try-catch": 8,
  fallback: 7,
  "permission-change": 10,
  "guard-removal": 9,
  "test-expectation": 9,
  validation: 8,
};

const LOCKFILE_PATTERN =
  /(^|\/)(?:package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|cargo\.lock|composer\.lock)$/i;
const GENERATED_PATH_PATTERN =
  /(^|\/)(?:node_modules|dist|build|coverage|\.next)(\/|$)|(?:\.generated\.|\.min\.)/i;
const TEST_PATH_PATTERN =
  /(^|\/)(?:test|tests|spec|__tests__)(\/|$)|\.(?:test|spec)\.[^.]+$/i;
const COMMENT_PATTERN = /^\s*(?:\/\/|\/\*|\*|\*\/|#|<!--|-->)\s?/;
const IMPORT_PATTERN = /^\s*(?:import\b|(?:const|let|var)\s+\w+\s*=\s*require\s*\()/;
const PERMISSION_PATTERN =
  /\b(?:permission|permissions|authorize|authorization|access|capabilit(?:y|ies)|role|roles|scope|trust|trusted|allow(?:ed)?|deny|denied|readonly|read-only)\b/i;
const VALIDATION_PATTERN =
  /\b(?:validat\w*|schema|parse\w*|saniti[sz]\w*|input|required|constraint|assert)\b/i;
const NEGATION_PATTERN = /(^|[^\w=!])!+(?!=)/;

function changedLines(hunk: DiffHunk): DiffLine[] {
  return hunk.lines.filter(
    (line) => line.kind === "added" || line.kind === "removed",
  );
}

function textOf(lines: readonly DiffLine[]): string {
  return lines.map((line) => line.text).join("\n");
}

function normalizedLines(lines: readonly DiffLine[]): string[] {
  return lines.map((line) => line.text.replace(/\s+/g, "").trim());
}

function isPureWhitespaceChange(hunk: DiffHunk): boolean {
  const removed = normalizedLines(
    hunk.lines.filter((line) => line.kind === "removed"),
  );
  const added = normalizedLines(
    hunk.lines.filter((line) => line.kind === "added"),
  );
  return (
    removed.length > 0 &&
    removed.length === added.length &&
    removed.every((line, index) => line === added[index])
  );
}

const NON_IDENTIFIERS = new Set([
  "if",
  "else",
  "return",
  "throw",
  "catch",
  "try",
  "const",
  "let",
  "var",
  "function",
  "class",
  "new",
  "true",
  "false",
  "null",
  "undefined",
  "async",
  "await",
]);

function maskRenamedIdentifiers(text: string): string {
  return text.replace(/\b[A-Za-z_$][\w$]*\b/g, (token) =>
    NON_IDENTIFIERS.has(token) ? token : "_",
  );
}

function isPureIdentifierRename(hunk: DiffHunk): boolean {
  const removed = hunk.lines.filter((line) => line.kind === "removed");
  const added = hunk.lines.filter((line) => line.kind === "added");
  if (removed.length === 0 || removed.length !== added.length) return false;
  if ([...removed, ...added].some((line) => /[\"'`]/.test(line.text))) {
    return false;
  }
  return removed.every(
    (line, index) =>
      maskRenamedIdentifiers(line.text) ===
      maskRenamedIdentifiers(added[index]!.text),
  );
}

function isNoiseLine(line: DiffLine): boolean {
  return line.text.trim().length === 0 || COMMENT_PATTERN.test(line.text);
}

function isImportOnly(lines: readonly DiffLine[]): boolean {
  return (
    lines.length > 0 &&
    lines.every((line) => IMPORT_PATTERN.test(line.text.trim()))
  );
}

function sortConcepts(concepts: Iterable<LearningConcept>): LearningConcept[] {
  return [...new Set(concepts)].sort(
    (left, right) =>
      CONCEPT_PRIORITY.indexOf(left) - CONCEPT_PRIORITY.indexOf(right),
  );
}

export function candidateIdForHunk(path: string, hunk: DiffHunk): string {
  const source = JSON.stringify({
    path,
    oldStart: hunk.oldStart,
    oldCount: hunk.oldCount,
    newStart: hunk.newStart,
    newCount: hunk.newCount,
    heading: hunk.heading ?? "",
    lines: hunk.lines.map((line) => [line.kind, line.text]),
  });
  return createHash("sha256").update(source).digest("hex").slice(0, 20);
}

export interface HunkClassification {
  concepts: LearningConcept[];
  learningValue: number;
  id: string;
}

/**
 * Conservative, text-level classification. It intentionally accepts false
 * negatives rather than inventing a semantic claim the hunk cannot prove.
 */
export function classifyHunk(
  path: string,
  hunk: DiffHunk,
): HunkClassification | undefined {
  if (
    hunk.lines.length === 0 ||
    hunk.lines.length > MAX_HUNK_LINES ||
    changedLines(hunk).length > MAX_CHANGED_LINES
  )
    return undefined;
  if (LOCKFILE_PATTERN.test(path) || GENERATED_PATH_PATTERN.test(path)) {
    return undefined;
  }

  const changed = changedLines(hunk);
  const meaningful = changed.filter((line) => !isNoiseLine(line));
  if (
    meaningful.length === 0 ||
    textOf(meaningful).length > MAX_HUNK_TEXT ||
    isPureWhitespaceChange(hunk) ||
    isPureIdentifierRename(hunk) ||
    isImportOnly(meaningful)
  ) {
    return undefined;
  }

  const removed = changed.filter((line) => line.kind === "removed");
  const added = changed.filter((line) => line.kind === "added");
  const removedText = textOf(removed);
  const addedText = textOf(added);
  const changedText = textOf(meaningful);
  const concepts = new Set<LearningConcept>();

  if (
    TEST_PATH_PATTERN.test(path) &&
    /\b(?:expect|assert|toBe|toEqual|toThrow|snapshot|deepEqual)\b/i.test(
      changedText,
    )
  ) {
    concepts.add("test-expectation");
  }
  if (PERMISSION_PATTERN.test(changedText)) concepts.add("permission-change");
  const guardPattern =
    /\bif\s*\([^\n]*\)\s*(?:\{?\s*)?(?:return|throw)\b/s;
  if (guardPattern.test(removedText) && !guardPattern.test(addedText)) {
    concepts.add("guard-removal");
  }
  if (/\bvalidat\w*\b|\bschema\b|\bparse\w*\b|\bsaniti[sz]\w*\b/i.test(changedText)) {
    concepts.add("validation");
  } else if (VALIDATION_PATTERN.test(changedText) && !TEST_PATH_PATTERN.test(path)) {
    concepts.add("validation");
  }
  if (/\bthrow\b/.test(changedText)) concepts.add("throw");
  if (/\b(?:try\s*\{|catch\s*\()/i.test(changedText)) {
    concepts.add("try-catch");
  }
  if (/\breturn\b/.test(changedText)) concepts.add("return");
  if (/&&/.test(changedText)) concepts.add("condition-and");
  if (/\|\|/.test(changedText)) concepts.add("condition-or");
  if (NEGATION_PATTERN.test(changedText)) concepts.add("negation");
  if (/\?\?/.test(changedText) || /\bfallback\b/i.test(changedText)) {
    concepts.add("fallback");
  }
  if (/\b(?:if|else\s+if)\s*\(/.test(changedText)) {
    concepts.add("condition-if");
  }

  if (concepts.size === 0) concepts.add("diff-basics");
  const ordered = sortConcepts(concepts);
  return {
    concepts: ordered,
    learningValue: Math.max(...ordered.map((concept) => CONCEPT_VALUE[concept])),
    id: candidateIdForHunk(path, hunk),
  };
}

export function classifyChange(
  change: DiffViewerChangeEvent,
): LearningCandidate[] {
  return change.hunks.flatMap((hunk) => {
    const classification = classifyHunk(change.path, hunk);
    if (!classification) return [];
    return [
      {
        id: classification.id,
        path: change.path,
        toolName: change.toolName,
        timestamp: change.timestamp,
        hunk,
        concepts: classification.concepts,
        learningValue: classification.learningValue,
      },
    ];
  });
}
