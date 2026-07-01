/**
 * Pure and filesystem-safe helpers for the plan workflow.
 */

import { createHash } from "node:crypto";
import {
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
import { isSafeCommand } from "../shared/bash-allowlist.ts";

export { isSafeCommand };

export const PLAN_RELATIVE_PATH = ".agent/plans/current-plan.md";
export const PLAN_ARCHIVE_RELATIVE_DIR = ".agent/plans/archive";

const REQUIRED_PLAN_HEADINGS = ["Auftrag", "Todos"];

export interface TodoItem {
  step: number;
  text: string;
  completed: boolean;
  lineIndex: number;
}

export type ReviewOutcome = "approved" | "changes-required" | "missing";

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

export function readPlanFile(cwd: string): string | undefined {
  const root = resolve(cwd);
  const planPath = getPlanPath(root);
  assertNoSymlinkComponents(root, planPath);
  if (!existsSync(planPath)) return undefined;
  return readFileSync(planPath, "utf8");
}

export function writePlanFileAtomic(cwd: string, content: string): void {
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

export function extractDoneSteps(message: string): number[] {
  return [
    ...new Set(
      [...message.matchAll(/\[DONE:(\d+)\]/gi)]
        .map((match) => Number(match[1]))
        .filter((step) => Number.isSafeInteger(step) && step > 0),
    ),
  ];
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

export function validatePlanStructure(planContent: string): string[] {
  const found = new Set(
    [...planContent.matchAll(/^##\s+(.+?)\s*$/gm)].map((match) =>
      normalizeHeading(match[1]),
    ),
  );
  const errors = REQUIRED_PLAN_HEADINGS.filter(
    (heading) => !found.has(normalizeHeading(heading)),
  ).map((heading) => `Fehlender Abschnitt: ${heading}`);

  if (extractTodoItems(planContent).length === 0) {
    errors.push("Der Todo-Abschnitt enthält keine Checkboxen.");
  }
  return errors;
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
): string {
  const root = resolve(cwd);
  const planPath = getPlanPath(root);
  const archiveDir = getPlanArchiveDir(root);
  const content = readPlanFile(root);
  if (content === undefined)
    throw new Error(`Plan file not found: ${planPath}`);

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
    renameSync(temporaryPath, archivePath);
    unlinkSync(planPath);
  } finally {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }

  return archivePath;
}

// Truncates long commands for display in error/block messages.
export function redactCommand(command: string): string {
  return command.length > 120 ? `${command.slice(0, 117)}...` : command;
}
