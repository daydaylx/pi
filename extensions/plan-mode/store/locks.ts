/**
 * Directory-based workflow lock.
 *
 * Deliberately without lease or heartbeat (Umbauvertrag §13.5): a stale lock is
 * only ever removed through an explicit, confirmed user action.
 */
import { existsSync, mkdirSync, rmdirSync, unlinkSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { WORKFLOW_LOCK_RELATIVE_PATH, ensureParent, workflowPath } from "./paths.ts";
import { serialize } from "./atomic-files.ts";
import type { WorkflowLockHandle } from "./types.ts";

export function acquireWorkflowLock(cwd: string): WorkflowLockHandle {
  const lockPath = workflowPath(cwd, WORKFLOW_LOCK_RELATIVE_PATH);
  ensureParent(cwd, lockPath);
  try {
    mkdirSync(lockPath, { mode: 0o700 });
  } catch {
    throw new Error(
      "Workflow-Lock ist belegt. Eine Übernahme erfolgt niemals zeitgesteuert; prüfe den aktiven Prozess oder nutze die bestätigte Recovery.",
    );
  }
  const ownerPath = join(lockPath, "owner.json");
  try {
    writeFileSync(
      ownerPath,
      serialize({
        pid: process.pid,
        ownerId: randomUUID(),
        createdAt: new Date().toISOString(),
      }),
      { encoding: "utf8", flag: "wx", mode: 0o600 },
    );
  } catch (error) {
    try {
      rmdirSync(lockPath);
    } catch {
      // The explicit recovery path handles a partially initialized lock.
    }
    throw error;
  }
  let released = false;
  return {
    path: lockPath,
    release(): void {
      if (released) return;
      released = true;
      if (existsSync(ownerPath)) unlinkSync(ownerPath);
      rmdirSync(lockPath);
    },
  };
}

export function withWorkflowLock<T>(cwd: string, action: () => T): T {
  const lock = acquireWorkflowLock(cwd);
  try {
    return action();
  } finally {
    lock.release();
  }
}

export function clearWorkflowLockAfterConfirmation(
  cwd: string,
  confirmed: boolean,
): void {
  if (!confirmed) throw new Error("Workflow-Lock wurde nicht bestätigt.");
  const lockPath = workflowPath(cwd, WORKFLOW_LOCK_RELATIVE_PATH);
  if (!existsSync(lockPath)) return;
  const entries = readdirSync(lockPath);
  if (entries.some((entry) => entry !== "owner.json")) {
    throw new Error("Workflow-Lock enthält unerwartete Dateien.");
  }
  const ownerPath = join(lockPath, "owner.json");
  if (existsSync(ownerPath)) unlinkSync(ownerPath);
  rmdirSync(lockPath);
}
