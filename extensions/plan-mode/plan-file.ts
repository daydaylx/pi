import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

export const PLAN_RELATIVE_PATH = ".agent/plans/current-plan.md";

function isInside(base: string, target: string): boolean {
  const rel = relative(base, target);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`));
}

/** Resolve the one plan file without accepting path traversal. */
export function planPath(cwd: string): string {
  const root = resolve(cwd);
  const target = resolve(root, PLAN_RELATIVE_PATH);
  if (!isInside(root, target))
    throw new Error("Planpfad verlässt das Projekt.");
  return target;
}

export function planExists(cwd: string): boolean {
  return existsSync(planPath(cwd));
}

export function readPlan(cwd: string): string | undefined {
  const path = planPath(cwd);
  return existsSync(path) ? readFileSync(path, "utf8") : undefined;
}

export function planParentPath(cwd: string): string {
  return dirname(planPath(cwd));
}

export function isPlanFilePath(value: unknown, cwd: string): boolean {
  if (typeof value !== "string" || !value.trim()) return false;
  return resolve(cwd, value) === planPath(cwd);
}
