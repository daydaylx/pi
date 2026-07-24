/**
 * Lightweight interrupted-task recovery status checker (issue #107, MVP).
 *
 * Pi's plan-mode already restores workflow state on `session_start`; this
 * module adds VISIBILITY: it reads the restored plan state (read-only,
 * without touching the state machine) and reports whether an interrupted
 * task is present, what its progress was, and whether the plan is stale.
 *
 * This is advisory: it does NOT gate or block continuation, leaving the
 * existing auto-restore behaviour intact.
 */
import { readFileSync } from "node:fs";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getWorkflowStatePath } from "../plan-mode/state.ts";
import { extractTodoItems, hashPlanContent, readPlanFile } from "../plan-mode/utils.ts";
import type { WorkflowPhase } from "../shared/workflow-status.ts";

export interface RecoveryStatus {
  /** Whether an interrupted task candidate was found. */
  interrupted: boolean;
  /** The detected workflow phase. */
  phase?: WorkflowPhase;
  /** Number of incomplete plan todos. */
  pendingTodos?: number;
  /** Total number of todos. */
  totalTodos?: number;
  /** Plan revision from the sidecar. */
  planRevision?: number;
  /** Whether the plan content matches the reviewed hash (stale check). */
  planStale?: boolean;
  /** Human-readable one-liner for a status label. */
  summary: string;
}

const INTERRUPTED_PHASES = new Set<WorkflowPhase>(["executing", "paused", "blocked"]);

export function checkRecoveryStatus(ctx: ExtensionContext): RecoveryStatus {
  let content: string | undefined;
  try {
    content = readPlanFile(ctx.cwd);
  } catch {
    /* plan unreadable — nothing to recover */
  }

  if (!content) {
    return { interrupted: false, summary: "kein Plan — keine Recovery nötig" };
  }

  let phase: WorkflowPhase = "idle";
  let revision: number | undefined;
  let reviewedHash: string | undefined;
  try {
    const statePath = getWorkflowStatePath(ctx.cwd);
    const raw = JSON.parse(readFileSync(statePath, "utf8"));
    if (raw?.phase) phase = raw.phase;
    if (typeof raw?.revision === "number") revision = raw.revision;
    if (typeof raw?.reviewedHash === "string") reviewedHash = raw.reviewedHash;
  } catch {
    /* state unreadable */
  }

  if (!INTERRUPTED_PHASES.has(phase)) {
    return {
      interrupted: false,
      phase,
      summary: `Plan-Phase '${phase}' — keine unterbrochene Aufgabe`,
    };
  }

  const todos = extractTodoItems(content);
  const pendingTodos = todos.filter((t) => !t.completed);
  const planStale =
    reviewedHash !== undefined ? hashPlanContent(content) !== reviewedHash : undefined;

  const flags: string[] = [];
  if (planStale) flags.push("Plan seit Review geändert");
  const flagText = flags.length > 0 ? ` — ⚠ ${flags.join(", ")}` : "";

  const summary = `Phase '${phase}' (Rev ${revision ?? "?"}), ${pendingTodos.length}/${todos.length} offene Todos${flagText}`;

  return {
    interrupted: true,
    phase,
    pendingTodos: pendingTodos.length,
    totalTodos: todos.length,
    planRevision: revision,
    planStale,
    summary,
  };
}
