/**
 * Path constants and path safety for all workflow artifacts.
 *
 * Single source for containment and symlink rules (Umbauvertrag §13.3: the
 * store owns path safety). Nothing else in the workflow may re-implement them.
 */
import { existsSync, lstatSync, mkdirSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

export const PLAN_RELATIVE_PATH = ".agent/plans/current-plan.md";
export const WORKFLOW_STATE_RELATIVE_PATH =
  ".agent/plans/current-plan.state.json";
export const COMPLETION_REPORT_RELATIVE_PATH =
  ".agent/plans/current-plan.completion.json";
export const WORKFLOW_LOCK_RELATIVE_PATH = ".agent/plans/.workflow.lock";
export const PLAN_ARCHIVE_RELATIVE_DIR = ".agent/plans/archive";
export const MIGRATION_BACKUP_RELATIVE_DIR = ".agent/plans/migration-backup";
export const DIRECT_TASK_RELATIVE_PATH = ".agent/direct-task.json";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInside(base: string, candidate: string): boolean {
  const rel = relative(base, candidate);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`));
}

export function assertSafePath(cwd: string, candidate: string): void {
  const root = resolve(cwd);
  const target = resolve(candidate);
  if (!isInside(root, target)) {
    throw new Error(`Workflow-Pfad verlässt das Projekt: ${candidate}`);
  }
  const rel = relative(root, target);
  let current = root;
  for (const segment of rel.split(sep).filter(Boolean)) {
    current = resolve(current, segment);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw new Error(
        `Symbolische Links sind in Workflow-Pfaden nicht erlaubt: ${current}`,
      );
    }
  }
}

export function ensureParent(cwd: string, path: string): void {
  const root = resolve(cwd);
  const parent = dirname(path);
  assertSafePath(root, parent);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  assertSafePath(root, parent);
}

export function workflowPath(cwd: string, relativePath: string): string {
  const path = resolve(cwd, relativePath);
  assertSafePath(cwd, path);
  return path;
}

/**
 * Whether a tool-supplied path is exactly the active plan file.
 *
 * Used by the permission layer to allow the one controlled write during
 * planning. Reuses assertSafePath so the symlink and containment rules have a
 * single source; returns false instead of throwing because callers ask this
 * as a predicate about untrusted input.
 */
export function isPlanFilePath(rawPath: unknown, cwd: string): boolean {
  if (typeof rawPath !== "string" || rawPath.trim() === "") return false;
  try {
    const root = resolve(cwd);
    const candidate = resolve(root, rawPath);
    if (candidate !== resolve(root, PLAN_RELATIVE_PATH)) return false;
    assertSafePath(root, candidate);
    return true;
  } catch {
    return false;
  }
}
