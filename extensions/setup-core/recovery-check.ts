/**
 * Interrupted-task recovery for issue #107.
 *
 * Pi's plan-mode already restores workflow state on `session_start`; this
 * module adds VISIBILITY (checkRecoveryStatus, read-only) and, in TUI
 * sessions, an interactive recovery dialog (offerRecoveryDialog) with the
 * user actions the issue calls for: resume, inspect the diff, re-run
 * verification, discard, or do nothing. It never resumes automatically —
 * every action requires an explicit choice.
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadWorkflowState, removeWorkflowState } from "../plan-mode/state.ts";
import {
  extractTodoItems,
  hashPlanContent,
  readPlanFile,
} from "../plan-mode/utils.ts";
import type { WorkflowPhase } from "../shared/workflow-status.ts";
import {
  formatGateReport,
  runVerificationGate,
  type GateContext,
} from "./verification-gate.ts";

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

const INTERRUPTED_PHASES = new Set<WorkflowPhase>([
  "executing",
  "paused",
  "blocked",
]);

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
    // Reuses the same recovery guarantees plan-mode itself relies on at
    // session_start (e.g. a persisted "executing" lifecycle is downgraded to
    // "paused" on load) instead of re-parsing the sidecar JSON directly.
    const loaded = loadWorkflowState(ctx.cwd);
    if (loaded.state) {
      phase = loaded.state.phase;
      revision = loaded.state.revision;
      reviewedHash = loaded.state.reviewedHash;
    }
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
    reviewedHash !== undefined
      ? hashPlanContent(content) !== reviewedHash
      : undefined;

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

const RESUME_OPTION = "Fortsetzen (Hinweis auf /work)";
const DIFF_OPTION = "Diff prüfen";
const REVERIFY_OPTION = "Verifikation erneut ausführen";
const DISCARD_OPTION = "Verwerfen (Workflow-Zustand zurücksetzen)";
const NOTHING_OPTION = "Nichts tun";

/**
 * Show the interactive recovery dialog for an interrupted task and act on
 * the user's choice. Only called when `ctx.hasUI && ctx.mode === "tui"` —
 * non-interactive sessions keep the existing read-only `/setup-doctor` line
 * instead. Never resumes or discards without an explicit selection.
 */
export async function offerRecoveryDialog(
  ctx: ExtensionContext,
  status: RecoveryStatus,
  exec: GateContext["exec"],
): Promise<void> {
  if (!status.interrupted) return;

  const staleNote = status.planStale
    ? " ⚠ Der Plan wurde seit dem letzten Review geändert."
    : "";
  const options = [
    RESUME_OPTION,
    DIFF_OPTION,
    REVERIFY_OPTION,
    DISCARD_OPTION,
    NOTHING_OPTION,
  ];
  const choice = await ctx.ui.select(
    `Unterbrochene Aufgabe gefunden: ${status.summary}${staleNote}`,
    options,
  );

  switch (choice) {
    case RESUME_OPTION:
      ctx.ui.notify(
        "Nutze /work, um die pausierte oder blockierte Ausführung sicher fortzusetzen (verlangt dort eine eigene Bestätigung).",
        "info",
      );
      return;
    case DIFF_OPTION: {
      const result = await runVerificationGate({
        projectRoot: ctx.cwd,
        trusted: ctx.isProjectTrusted(),
        exec,
      });
      const lines = [
        `Working-Tree-Diff (${result.changedFiles.length} Datei(en)):`,
        ...result.changedFiles.map((f) => `  ${f.status} ${f.path}`),
        ...(result.diffStat ? ["", result.diffStat] : []),
      ];
      ctx.ui.notify(lines.join("\n"), "info");
      return;
    }
    case REVERIFY_OPTION: {
      const result = await runVerificationGate({
        projectRoot: ctx.cwd,
        trusted: ctx.isProjectTrusted(),
        exec,
      });
      ctx.ui.notify(
        formatGateReport(result),
        result.status === "pass" ? "info" : "warning",
      );
      return;
    }
    case DISCARD_OPTION: {
      const confirmed = await ctx.ui.confirm(
        "Workflow-Zustand wirklich verwerfen?",
        "Der Sidecar-Zustand wird entfernt; der Plan-Inhalt selbst bleibt erhalten. Diese Aktion ist nicht rückgängig zu machen.",
      );
      if (!confirmed) {
        ctx.ui.notify("Verwerfen abgebrochen.", "info");
        return;
      }
      removeWorkflowState(ctx.cwd);
      ctx.ui.notify(
        "Workflow-Zustand verworfen. Der Plan-Inhalt ist unverändert.",
        "info",
      );
      return;
    }
    case NOTHING_OPTION:
    default:
      return;
  }
}
