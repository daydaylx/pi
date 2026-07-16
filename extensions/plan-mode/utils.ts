/**
 * Pure and filesystem-safe helpers for the plan workflow.
 */

import { createHash, randomUUID } from "node:crypto";
import {
  constants as fsConstants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

export const PLAN_RELATIVE_PATH = ".agent/plans/current-plan.md";
export const PLAN_ARCHIVE_RELATIVE_DIR = ".agent/plans/archive";
export const PLAN_MAX_BYTES = 256 * 1024;
export const DECISION_BRIEF_MAX_BYTES = 128 * 1024;
export const PLAN_MAX_TODOS = 200;
export const PLAN_METADATA_VERSION = 2 as const;
export const PLAN_METADATA_PREFIX = "PI-PLAN-METADATA:";

// Das Decision Brief ist ein eigenständiges Artefakt der vorgeschalteten
// Klärung. Es liegt im selben .agent/plans-Verzeichnis wie der finale Plan,
// ersetzt aber current-plan.md nicht und wird von der Permission-Policy nicht
// gesondert behandelt: die Extension schreibt die Datei selbst (analog
// writePlanFileAtomic), damit der Klär-Turn auf jeder Zugriffsstufe läuft.
export const DECISION_BRIEF_RELATIVE_PATH = ".agent/plans/decision-brief.md";
export const INVALID_DECISION_BRIEF_RELATIVE_PATH =
  ".agent/plans/invalid-decision-brief.md";
export const DECISION_BUDGET_DEFAULT = 6;
export const DECISION_BUDGET_COMPLEX = 8;
export const DECISION_BRIEF_BLOCK_START = "[DECISION-BRIEF]";
export const DECISION_BRIEF_BLOCK_END = "[/DECISION-BRIEF]";

const REQUIRED_PLAN_HEADINGS = ["Auftrag", "Todos"];
const REQUIRED_DETAILED_PLAN_HEADINGS = [
  "Auftrag",
  "Nicht-Ziele",
  "Betroffene Bereiche",
  "Risiken / Entscheidungen",
  "Todos",
  "Tests / Checks",
  "Abschlusskriterien",
];
const REQUIRED_BRIEF_HEADINGS = [
  "Ziel",
  "Entscheidungen",
  "Abschlusskriterien",
];

export interface TodoItem {
  step: number;
  text: string;
  completed: boolean;
  lineIndex: number;
}

export type PlanType = "simple_plan" | "detailed_plan" | "unknown";

export interface PlanMetadata {
  version: typeof PLAN_METADATA_VERSION;
  planId: string;
  planType: Exclude<PlanType, "unknown">;
}

export type ArtifactReadResult =
  | { status: "ok"; content: string; bytes: number }
  | { status: "missing" }
  | { status: "unreadable"; error: string };

export type ReviewOutcome = "approved" | "changes-required" | "missing";

const PLAN_METADATA_PATTERN =
  /<!--\s*PI-PLAN-METADATA:\s*(\{[^\r\n]*\})\s*-->/g;
const ANY_PLAN_METADATA_LINE_PATTERN =
  /^[ \t]*<!--\s*PI-PLAN-METADATA:[^\r\n]*-->[ \t]*(?:\r?\n)?/gm;

function byteLength(content: string): number {
  return Buffer.byteLength(content, "utf8");
}

function assertArtifactSize(
  name: string,
  content: string,
  maximumBytes: number,
): void {
  const bytes = byteLength(content);
  if (bytes > maximumBytes) {
    throw new Error(
      `${name} ist zu groß (${bytes} Bytes; maximal ${maximumBytes} Bytes).`,
    );
  }
}

function isInside(basePath: string, candidatePath: string): boolean {
  const rel = relative(basePath, candidatePath);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== "..");
}

function assertNoSymlinkComponents(
  basePath: string,
  candidatePath: string,
): void {
  if (!isInside(basePath, candidatePath)) {
    throw new Error(`Path escapes working directory: ${candidatePath}`);
  }

  const rel = relative(basePath, candidatePath);
  let current = basePath;
  for (const segment of rel.split(sep).filter(Boolean)) {
    current = resolve(current, segment);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw new Error(
        `Symbolic links are not allowed in plan paths: ${current}`,
      );
    }
  }
}

export function getPlanPath(cwd: string): string {
  return resolve(cwd, PLAN_RELATIVE_PATH);
}

export function getPlanArchiveDir(cwd: string): string {
  return resolve(cwd, PLAN_ARCHIVE_RELATIVE_DIR);
}

export function isPlanFilePath(rawPath: unknown, cwd: string): boolean {
  if (typeof rawPath !== "string" || rawPath.trim() === "") return false;

  const root = resolve(cwd);
  const candidate = resolve(root, rawPath);
  const allowed = getPlanPath(root);
  if (candidate !== allowed) return false;

  try {
    assertNoSymlinkComponents(root, candidate);
    return true;
  } catch {
    return false;
  }
}

export function ensurePlanDirectory(cwd: string): string {
  const root = resolve(cwd);
  const planPath = getPlanPath(root);
  const planDir = dirname(planPath);

  assertNoSymlinkComponents(root, planDir);
  mkdirSync(planDir, { recursive: true });
  assertNoSymlinkComponents(root, planDir);
  return planDir;
}

export function readArtifactTriState(
  cwd: string,
  relativePath: string,
  maximumBytes: number,
): ArtifactReadResult {
  const root = resolve(cwd);
  const artifactPath = resolve(root, relativePath);
  try {
    assertNoSymlinkComponents(root, artifactPath);
    if (!existsSync(artifactPath)) return { status: "missing" };
    const file = statSync(artifactPath);
    if (!file.isFile()) {
      return {
        status: "unreadable",
        error: `Artefakt ist keine reguläre Datei: ${artifactPath}`,
      };
    }
    if (file.size > maximumBytes) {
      return {
        status: "unreadable",
        error: `Artefakt ist zu groß (${file.size} Bytes; maximal ${maximumBytes} Bytes).`,
      };
    }
    const content = readFileSync(artifactPath, "utf8");
    const bytes = byteLength(content);
    if (bytes > maximumBytes) {
      return {
        status: "unreadable",
        error: `Artefakt ist zu groß (${bytes} Bytes; maximal ${maximumBytes} Bytes).`,
      };
    }
    return { status: "ok", content, bytes };
  } catch (error) {
    return {
      status: "unreadable",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function readPlanFileState(cwd: string): ArtifactReadResult {
  return readArtifactTriState(cwd, PLAN_RELATIVE_PATH, PLAN_MAX_BYTES);
}

export function readPlanFile(cwd: string): string | undefined {
  const result = readPlanFileState(cwd);
  if (result.status === "missing") return undefined;
  if (result.status === "unreadable") throw new Error(result.error);
  return result.content;
}

export function writePlanFileAtomic(cwd: string, content: string): void {
  assertArtifactSize("Plan", content, PLAN_MAX_BYTES);
  const todoCount = extractTodoItems(content).length;
  if (todoCount > PLAN_MAX_TODOS) {
    throw new Error(
      `Plan enthält zu viele Todos (${todoCount}; maximal ${PLAN_MAX_TODOS}).`,
    );
  }
  const root = resolve(cwd);
  const planPath = getPlanPath(root);
  ensurePlanDirectory(root);
  assertNoSymlinkComponents(root, planPath);

  const mode = existsSync(planPath) ? statSync(planPath).mode & 0o777 : 0o600;
  const temporaryPath = `${planPath}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(temporaryPath, content, {
      encoding: "utf8",
      flag: "wx",
      mode,
    });
    renameSync(temporaryPath, planPath);
  } finally {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
}

function isPlanMetadata(value: unknown): value is PlanMetadata {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const metadata = value as Record<string, unknown>;
  return (
    metadata.version === PLAN_METADATA_VERSION &&
    typeof metadata.planId === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      metadata.planId,
    ) &&
    (metadata.planType === "simple_plan" ||
      metadata.planType === "detailed_plan")
  );
}

export function parsePlanMetadata(planContent: string): PlanMetadata | undefined {
  const matches = [...planContent.matchAll(PLAN_METADATA_PATTERN)];
  if (matches.length !== 1) return undefined;
  try {
    const value = JSON.parse(matches[0][1]) as unknown;
    return isPlanMetadata(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export function formatPlanMetadata(metadata: PlanMetadata): string {
  if (!isPlanMetadata(metadata)) throw new Error("Ungültige Plan-Metadaten.");
  return `<!-- ${PLAN_METADATA_PREFIX} ${JSON.stringify(metadata)} -->`;
}

export function ensurePlanMetadataHeader(
  planContent: string,
  planType: Exclude<PlanType, "unknown">,
  planId: string = randomUUID(),
): { content: string; metadata: PlanMetadata; changed: boolean } {
  const existing = parsePlanMetadata(planContent);
  if (existing) {
    const effectiveType =
      existing.planType === "detailed_plan" ? "detailed_plan" : planType;
    const metadata = { ...existing, planType: effectiveType };
    if (metadata.planType === existing.planType) {
      return { content: planContent, metadata: existing, changed: false };
    }
    return {
      content: planContent.replace(PLAN_METADATA_PATTERN, formatPlanMetadata(metadata)),
      metadata,
      changed: true,
    };
  }

  const metadata: PlanMetadata = {
    version: PLAN_METADATA_VERSION,
    planId,
    planType,
  };
  const header = formatPlanMetadata(metadata);
  const sanitized = planContent.replace(ANY_PLAN_METADATA_LINE_PATTERN, "");
  const firstLineEnd = sanitized.indexOf("\n");
  const content = firstLineEnd >= 0 && /^#\s+/.test(sanitized.slice(0, firstLineEnd))
    ? `${sanitized.slice(0, firstLineEnd)}\n${header}${sanitized.slice(firstLineEnd)}`
    : `${header}\n${sanitized}`;
  assertArtifactSize("Plan", content, PLAN_MAX_BYTES);
  return { content, metadata, changed: true };
}

function normalizeHeading(value: string): string {
  return value
    .replace(/^\d+\.\s*/, "")
    .trim()
    .toLocaleLowerCase("de-DE");
}

function findTodoSection(
  lines: string[],
): { start: number; end: number } | undefined {
  const target = normalizeHeading("Todos");
  const start = lines.findIndex((line) => {
    const match = line.match(/^##\s+(.+?)\s*$/);
    return match ? normalizeHeading(match[1]) === target : false;
  });
  if (start < 0) return undefined;

  const nextHeading = lines.findIndex(
    (line, index) => index > start && /^##\s+/.test(line),
  );
  return {
    start: start + 1,
    end: nextHeading < 0 ? lines.length : nextHeading,
  };
}

export function cleanStepText(text: string): string {
  let cleaned = text
    .replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned.length > 0) {
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }
  if (cleaned.length > 80) {
    cleaned = `${cleaned.slice(0, 77)}...`;
  }
  return cleaned;
}

export function extractTodoItems(planContent: string): TodoItem[] {
  const lines = planContent.split(/\r?\n/);
  const section = findTodoSection(lines);
  if (!section) return [];

  const items: TodoItem[] = [];
  for (let index = section.start; index < section.end; index += 1) {
    const match = lines[index].match(/^\s*[-*]\s+\[([ xX])\]\s+(.+?)\s*$/);
    if (!match) continue;
    const text = cleanStepText(match[2]);
    if (!text) continue;
    items.push({
      step: items.length + 1,
      text,
      completed: match[1].trim() !== "",
      lineIndex: index,
    });
  }
  return items;
}

export function computeTodoHash(todo: Pick<TodoItem, "text"> | string): string {
  const text = typeof todo === "string" ? todo : todo.text;
  return createHash("sha256")
    .update(text.trim().replace(/\s+/g, " ").toLocaleLowerCase("de-DE"), "utf8")
    .digest("hex");
}

export function extractDoneSteps(message: string): number[] {
  return [
    ...new Set(
      [...message.matchAll(/\[DONE:(\d+)\]/gi)]
        .map((match) => Number(match[1]))
        .filter((step) => Number.isSafeInteger(step) && step > 0),
    ),
  ];
}

const PLAN_PROGRESS_BLOCK_PATTERN =
  /\[PLAN-PROGRESS\]([\s\S]*?)\[\/PLAN-PROGRESS\]/i;

/**
 * Parst einen [PLAN-PROGRESS]...[/PLAN-PROGRESS]-Block und liefert die
 * Schritt-Nummern aus dem DONE:-Abschnitt. Gibt undefined zurück, wenn kein
 * Block vorhanden ist (ermöglicht Fallback auf extractDoneSteps). Ein leerer
 * Block oder DONE-Abschnitt ohne Einträge liefert ein leeres Array.
 */
export function extractProgressBlock(message: string): number[] | undefined {
  const blockMatch = message.match(PLAN_PROGRESS_BLOCK_PATTERN);
  if (!blockMatch) return undefined;

  const lines = blockMatch[1].split(/\r?\n/);
  const done: number[] = [];
  let inDone = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^DONE:\s*$/i.test(trimmed)) {
      inDone = true;
      continue;
    }
    if (/^[A-Z_]+:\s*$/i.test(trimmed)) {
      inDone = false;
      continue;
    }
    if (!inDone) continue;
    const m = trimmed.match(/^[-*•]\s+T?(\d+)/i);
    if (m) {
      const n = Number(m[1]);
      if (Number.isSafeInteger(n) && n > 0) done.push(n);
    }
  }

  return [...new Set(done)];
}

export function applyDoneSteps(
  planContent: string,
  completedSteps: readonly number[],
): { content: string; updated: number } {
  const requested = new Set(completedSteps);
  if (requested.size === 0) return { content: planContent, updated: 0 };

  const lines = planContent.split(/\r?\n/);
  const todos = extractTodoItems(planContent);
  let updated = 0;

  for (const todo of todos) {
    if (!requested.has(todo.step) || todo.completed) continue;
    lines[todo.lineIndex] = lines[todo.lineIndex].replace(
      /^(\s*[-*]\s+)\[ \]/,
      "$1[x]",
    );
    updated += 1;
  }

  return {
    content: lines.join("\n"),
    updated,
  };
}

export function validatePlanStructure(
  planContent: string,
  planMode?: "simple_plan" | "detailed_plan",
): string[] {
  const required =
    planMode === "detailed_plan"
      ? REQUIRED_DETAILED_PLAN_HEADINGS
      : REQUIRED_PLAN_HEADINGS;
  const lines = planContent.split(/\r?\n/);
  const headings = lines.flatMap((line, lineIndex) => {
    const match = line.match(/^##\s+(.+?)\s*$/);
    return match
      ? [{ lineIndex, normalized: normalizeHeading(match[1]) }]
      : [];
  });
  const errors: string[] = [];
  let previousIndex = -1;

  for (const heading of required) {
    const normalized = normalizeHeading(heading);
    const occurrences = headings.filter(
      (candidate) => candidate.normalized === normalized,
    );
    if (occurrences.length === 0) {
      errors.push(`Fehlender Abschnitt: ${heading}`);
      continue;
    }
    if (occurrences.length > 1) {
      errors.push(`Abschnitt kommt mehrfach vor: ${heading}`);
    }
    const headingIndex = headings.findIndex(
      (candidate) => candidate === occurrences[0],
    );
    if (headingIndex < previousIndex) {
      errors.push(`Abschnitt ist in falscher Reihenfolge: ${heading}`);
    }
    previousIndex = Math.max(previousIndex, headingIndex);

    const start = occurrences[0].lineIndex + 1;
    const nextHeading = lines.findIndex(
      (line, index) => index >= start && /^##\s+/.test(line),
    );
    const end = nextHeading < 0 ? lines.length : nextHeading;
    if (lines.slice(start, end).join("\n").trim() === "") {
      errors.push(`Leerer Abschnitt: ${heading}`);
    }
  }

  const todos = extractTodoItems(planContent);
  if (todos.length === 0) {
    errors.push("Der Todo-Abschnitt enthält keine Checkboxen.");
  }
  if (todos.length > PLAN_MAX_TODOS) {
    errors.push(
      `Der Plan enthält zu viele Todos (${todos.length}; maximal ${PLAN_MAX_TODOS}).`,
    );
  }
  const bytes = byteLength(planContent);
  if (bytes > PLAN_MAX_BYTES) {
    errors.push(
      `Der Plan ist zu groß (${bytes} Bytes; maximal ${PLAN_MAX_BYTES} Bytes).`,
    );
  }
  return errors;
}

export function inferPlanType(planContent: string): PlanType {
  const metadata = parsePlanMetadata(planContent);
  if (metadata?.planType === "detailed_plan") return "detailed_plan";
  if (validatePlanStructure(planContent, "detailed_plan").length === 0) {
    return "detailed_plan";
  }
  if (metadata?.planType === "simple_plan") return "simple_plan";
  return "unknown";
}

export function hashPlanContent(planContent: string): string {
  return createHash("sha256").update(planContent, "utf8").digest("hex");
}

export function getReviewOutcome(message: string): ReviewOutcome {
  if (/\[PLAN-REVIEW:CHANGES-REQUIRED\]/i.test(message)) {
    return "changes-required";
  }
  if (/\[PLAN-REVIEW:APPROVED\]/i.test(message)) return "approved";
  return "missing";
}

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

export function formatArchiveTimestamp(date: Date): string {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-` +
    `${pad(date.getHours())}${pad(date.getMinutes())}`
  );
}

export function archivePlanFile(
  cwd: string,
  status: "complete" | "incomplete",
  now = new Date(),
  expectedPlanHash?: string,
): string {
  const root = resolve(cwd);
  const planPath = getPlanPath(root);
  const archiveDir = getPlanArchiveDir(root);
  const content = readPlanFile(root);
  if (content === undefined)
    throw new Error(`Plan file not found: ${planPath}`);
  const initialHash = hashPlanContent(content);
  if (expectedPlanHash !== undefined && initialHash !== expectedPlanHash) {
    throw new Error("Plan wurde zwischenzeitlich geändert; Archivierung abgebrochen.");
  }

  assertNoSymlinkComponents(root, archiveDir);
  mkdirSync(archiveDir, { recursive: true });
  assertNoSymlinkComponents(root, archiveDir);

  const timestamp = formatArchiveTimestamp(now);
  let suffix = 1;
  let archivePath = resolve(archiveDir, `${timestamp}-current-plan.md`);
  while (existsSync(archivePath)) {
    suffix += 1;
    archivePath = resolve(archiveDir, `${timestamp}-${suffix}-current-plan.md`);
  }

  const separator = content.endsWith("\n") ? "\n" : "\n\n";
  const archivedContent =
    `${content}${separator}---\n` +
    `Archived: ${now.toISOString()}\nStatus: ${status}\n`;
  const temporaryPath = `${archivePath}.tmp-${process.pid}-${Date.now()}`;

  try {
    writeFileSync(temporaryPath, archivedContent, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    const current = readPlanFile(root);
    if (current === undefined || hashPlanContent(current) !== initialHash) {
      throw new Error("Plan wurde zwischenzeitlich geändert; Archivierung abgebrochen.");
    }
    copyFileSync(temporaryPath, archivePath, fsConstants.COPYFILE_EXCL);
    unlinkSync(planPath);
  } finally {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }

  return archivePath;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Das Extraktions-Muster wird aus den Block-Marker-Konstanten gebaut, damit
// Injektion (Prompt) und Erkennung (agent_end) nie auseinanderdriften.
const DECISION_BRIEF_BLOCK_PATTERN = new RegExp(
  `${escapeRegExp(DECISION_BRIEF_BLOCK_START)}\\s*([\\s\\S]*?)${escapeRegExp(DECISION_BRIEF_BLOCK_END)}`,
  "i",
);

export function getDecisionBriefPath(cwd: string): string {
  return resolve(cwd, DECISION_BRIEF_RELATIVE_PATH);
}

export function isDecisionBriefPath(rawPath: unknown, cwd: string): boolean {
  if (typeof rawPath !== "string" || rawPath.trim() === "") return false;

  const root = resolve(cwd);
  const candidate = resolve(root, rawPath);
  const allowed = getDecisionBriefPath(root);
  if (candidate !== allowed) return false;

  try {
    assertNoSymlinkComponents(root, candidate);
    return true;
  } catch {
    return false;
  }
}

export function readDecisionBrief(cwd: string): string | undefined {
  const result = readDecisionBriefState(cwd);
  if (result.status === "missing") return undefined;
  if (result.status === "unreadable") throw new Error(result.error);
  return result.content;
}

export function readDecisionBriefState(cwd: string): ArtifactReadResult {
  return readArtifactTriState(
    cwd,
    DECISION_BRIEF_RELATIVE_PATH,
    DECISION_BRIEF_MAX_BYTES,
  );
}

export function writeDecisionBriefAtomic(cwd: string, content: string): void {
  assertArtifactSize("Decision Brief", content, DECISION_BRIEF_MAX_BYTES);
  const root = resolve(cwd);
  const briefPath = getDecisionBriefPath(root);
  ensurePlanDirectory(root);
  assertNoSymlinkComponents(root, briefPath);

  const mode = existsSync(briefPath) ? statSync(briefPath).mode & 0o777 : 0o600;
  const temporaryPath = `${briefPath}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(temporaryPath, content, {
      encoding: "utf8",
      flag: "wx",
      mode,
    });
    renameSync(temporaryPath, briefPath);
  } finally {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
}

export function getInvalidDecisionBriefPath(cwd: string): string {
  return resolve(cwd, INVALID_DECISION_BRIEF_RELATIVE_PATH);
}

export function writeInvalidDecisionBriefAtomic(
  cwd: string,
  content: string,
): void {
  assertArtifactSize("Decision Brief", content, DECISION_BRIEF_MAX_BYTES);
  const root = resolve(cwd);
  const briefPath = getInvalidDecisionBriefPath(root);
  ensurePlanDirectory(root);
  assertNoSymlinkComponents(root, briefPath);

  const mode = existsSync(briefPath) ? statSync(briefPath).mode & 0o777 : 0o600;
  const temporaryPath = `${briefPath}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(temporaryPath, content, {
      encoding: "utf8",
      flag: "wx",
      mode,
    });
    renameSync(temporaryPath, briefPath);
  } finally {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
}

export function archiveDecisionBrief(cwd: string, now = new Date()): string {
  const root = resolve(cwd);
  const briefPath = getDecisionBriefPath(root);
  const archiveDir = getPlanArchiveDir(root);
  const content = readDecisionBrief(root);
  if (content === undefined)
    throw new Error(`Decision brief not found: ${briefPath}`);

  assertNoSymlinkComponents(root, archiveDir);
  mkdirSync(archiveDir, { recursive: true });
  assertNoSymlinkComponents(root, archiveDir);

  const timestamp = formatArchiveTimestamp(now);
  let suffix = 1;
  let archivePath = resolve(archiveDir, `${timestamp}-decision-brief.md`);
  while (existsSync(archivePath)) {
    suffix += 1;
    archivePath = resolve(
      archiveDir,
      `${timestamp}-${suffix}-decision-brief.md`,
    );
  }

  const separator = content.endsWith("\n") ? "\n" : "\n\n";
  const archivedContent =
    `${content}${separator}---\n` +
    `Archived: ${now.toISOString()}\nStatus: superseded\n`;
  const temporaryPath = `${archivePath}.tmp-${process.pid}-${Date.now()}`;

  try {
    writeFileSync(temporaryPath, archivedContent, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    renameSync(temporaryPath, archivePath);
    unlinkSync(briefPath);
  } finally {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }

  return archivePath;
}

/**
 * Extrahiert den Decision-Brief-Inhalt aus dem `[DECISION-BRIEF]…[/DECISION-BRIEF]`
 * Block der letzten Agent-Antwort. Liefert undefined, wenn kein Block vorhanden
 * ist — der Aufrufer entscheidet konservativ, dann nichts zu speichern.
 */
export function extractDecisionBriefBlock(message: string): string | undefined {
  const match = message.match(DECISION_BRIEF_BLOCK_PATTERN);
  return match ? match[1].trim() : undefined;
}

export function validateDecisionBriefStructure(briefContent: string): string[] {
  const lines = briefContent.split(/\r?\n/);
  const errors: string[] = [];

  const bytes = byteLength(briefContent);
  if (bytes > DECISION_BRIEF_MAX_BYTES) {
    errors.push(
      `Das Decision Brief ist zu groß (${bytes} Bytes; maximal ${DECISION_BRIEF_MAX_BYTES} Bytes).`,
    );
  }

  for (const heading of REQUIRED_BRIEF_HEADINGS) {
    const headingIndex = lines.findIndex((line) => {
      const m = line.match(/^##\s+(.+?)\s*$/);
      return m ? normalizeHeading(m[1]) === normalizeHeading(heading) : false;
    });

    if (headingIndex < 0) {
      errors.push(`Fehlender Abschnitt: ${heading}`);
      continue;
    }

    const nextH = lines.findIndex(
      (l, i) => i > headingIndex && /^##\s+/.test(l),
    );
    const end = nextH < 0 ? lines.length : nextH;
    const sectionContent = lines
      .slice(headingIndex + 1, end)
      .join("\n")
      .trim();
    if (!sectionContent) {
      errors.push(`Leerer Abschnitt: ${heading}`);
    }
  }

  return errors;
}
