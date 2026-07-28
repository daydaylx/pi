/** Direct tasks: small, plan-less jobs with their own scope contract. */
import { existsSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { isSafeTechnicalScopeEntry } from "../plan-snapshot.ts";
import { DIRECT_TASK_RELATIVE_PATH, isRecord, workflowPath } from "./paths.ts";
import { readBounded, serialize, writeAtomic } from "./atomic-files.ts";
import { MAX_DIRECT_TASK_BYTES, type DirectTask } from "./types.ts";

function parseStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) &&
    value.every((entry) => typeof entry === "string" && entry.trim())
    ? value.map((entry) => entry.trim())
    : undefined;
}

export function parseDirectTask(value: unknown): DirectTask | undefined {
  if (!isRecord(value) || value.version !== 1) return undefined;
  const scope = parseStringArray(value.technicalScope);
  const verification = parseStringArray(value.verification);
  const acceptance = parseStringArray(value.acceptanceCriteria);
  if (
    typeof value.taskId !== "string" ||
    typeof value.goal !== "string" ||
    !value.goal.trim() ||
    !scope ||
    !scope.every(isSafeTechnicalScopeEntry) ||
    !verification ||
    !acceptance ||
    typeof value.updatedAt !== "string"
  ) {
    return undefined;
  }
  return {
    version: 1,
    taskId: value.taskId,
    goal: value.goal.trim(),
    technicalScope: scope,
    verification,
    acceptanceCriteria: acceptance,
    updatedAt: value.updatedAt,
  };
}

export function loadDirectTask(cwd: string): DirectTask | undefined {
  const raw = readBounded(
    cwd,
    workflowPath(cwd, DIRECT_TASK_RELATIVE_PATH),
    MAX_DIRECT_TASK_BYTES,
  );
  if (raw === undefined) return undefined;
  try {
    const parsed = parseDirectTask(JSON.parse(raw) as unknown);
    if (!parsed) throw new Error("Direktauftrag ist ungültig.");
    return parsed;
  } catch (error) {
    throw new Error(
      `Direktauftrag kann nicht gelesen werden: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function saveDirectTask(
  cwd: string,
  task: Omit<DirectTask, "version" | "taskId" | "updatedAt"> &
    Partial<Pick<DirectTask, "taskId">>,
): DirectTask {
  const value: DirectTask = {
    version: 1,
    taskId: task.taskId ?? randomUUID(),
    goal: task.goal.trim(),
    technicalScope: [...task.technicalScope],
    verification: [...task.verification],
    acceptanceCriteria: [...task.acceptanceCriteria],
    updatedAt: new Date().toISOString(),
  };
  if (!parseDirectTask(value)) throw new Error("Direktauftrag ist ungültig.");
  writeAtomic(
    cwd,
    workflowPath(cwd, DIRECT_TASK_RELATIVE_PATH),
    serialize(value),
    MAX_DIRECT_TASK_BYTES,
  );
  return value;
}

export function clearDirectTask(cwd: string): void {
  const path = workflowPath(cwd, DIRECT_TASK_RELATIVE_PATH);
  if (existsSync(path)) unlinkSync(path);
}
