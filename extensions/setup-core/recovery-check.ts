/**
 * Interrupted-task recovery for issue #107.
 *
 * Pi's plan-mode already restores workflow state on `session_start`; this
 * module adds VISIBILITY (checkRecoveryStatus, read-only) and, in TUI
 * sessions, an interactive recovery dialog (offerRecoveryDialog) with the
 * user actions the issue calls for: resume, inspect the diff, re-run
 * verification, discard, or do nothing. It never resumes automatically —
 * every action requires an explicit choice.
 *
 * Also covers recovery for direct tasks (#102/#106 follow-up): a
 * `source:"direct"` task-contract left over from an interrupted `/task`
 * session is a separate, unrelated candidate to an interrupted plan. A plan
 * interruption always takes precedence when both exist; a direct contract
 * found while a plan workflow is concurrently active is flagged as likely
 * stale (see the coexistence rule — `/plan` never touches an existing direct
 * contract itself).
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  loadWorkflowState,
  removeWorkflowStateAtomicCAS,
} from "../plan-mode/state.ts";
import {
  extractTodoItems,
  hashPlanContent,
  readPlanFile,
} from "../plan-mode/utils.ts";
import type { WorkflowPhase } from "../shared/workflow-status.ts";
import { clearTaskContract, loadTaskContract } from "./task-contract.ts";
import {
  formatGateReport,
  runVerificationGate,
  type GateContext,
} from "./verification-gate.ts";

export interface RecoveryStatus {
  /** Whether an interrupted task candidate was found. */
  interrupted: boolean;
  /** The detected workflow phase (plan candidate only). */
  phase?: WorkflowPhase;
  /** Number of incomplete plan todos (plan candidate only). */
  pendingTodos?: number;
  /** Total number of todos (plan candidate only). */
  totalTodos?: number;
  /** Plan revision from the sidecar (plan candidate only). */
  planRevision?: number;
  /** Whether the plan content matches the reviewed hash (plan candidate only). */
  planStale?: boolean;
  /** Goal of an interrupted direct task, if that's what was found instead of a plan. */
  directTaskGoal?: string;
  /** A plan workflow is concurrently active while this direct contract exists — likely stale. */
  directTaskLikelyStale?: boolean;
  /** Human-readable one-liner for a status label. */
  summary: string;
}

const INTERRUPTED_PHASES = new Set<WorkflowPhase>([
  "executing",
  "paused",
  "blocked",
]);
const IDLE_PLAN_PHASES = new Set<WorkflowPhase>(["idle", "draft"]);

export function checkRecoveryStatus(ctx: ExtensionContext): RecoveryStatus {
  let content: string | undefined;
  try {
    content = readPlanFile(ctx.cwd);
  } catch {
    /* plan unreadable — nothing to recover */
  }

  let phase: WorkflowPhase = "idle";
  let revision: number | undefined;
  let reviewedHash: string | undefined;
  let mode: "work" | "simple_plan" | "detailed_plan" = "work";
  if (content !== undefined) {
    try {
      // Reuses the same recovery guarantees plan-mode itself relies on at
      // session_start (e.g. a persisted "executing" lifecycle is downgraded
      // to "paused" on load) instead of re-parsing the sidecar JSON directly.
      const loaded = loadWorkflowState(ctx.cwd);
      if (loaded.state) {
        phase = loaded.state.phase;
        revision = loaded.state.revision;
        reviewedHash = loaded.state.reviewedHash;
        mode = loaded.state.mode;
      }
    } catch {
      /* state unreadable */
    }
  }

  // A plan interruption always takes precedence over a direct-task candidate.
  if (content !== undefined && INTERRUPTED_PHASES.has(phase)) {
    const todos = extractTodoItems(content);
    const pendingTodos = todos.filter((t) => !t.completed);
    const planStale =
      reviewedHash !== undefined
        ? hashPlanContent(content) !== reviewedHash
        : undefined;

    const flags: string[] = [];
    if (planStale) flags.push("Plan seit Review geändert");
    const flagText = flags.length > 0 ? ` — ⚠ ${flags.join(", ")}` : "";

    return {
      interrupted: true,
      phase,
      pendingTodos: pendingTodos.length,
      totalTodos: todos.length,
      planRevision: revision,
      planStale,
      summary: `Phase '${phase}' (Rev ${revision ?? "?"}), ${pendingTodos.length}/${todos.length} offene Todos${flagText}`,
    };
  }

  // No interrupted plan — check for an interrupted direct task instead.
  const loadedContract = loadTaskContract(ctx.cwd);
  if (loadedContract.contract?.source === "direct") {
    const planWorkflowActive =
      content !== undefined &&
      (mode !== "work" || !IDLE_PLAN_PHASES.has(phase));
    const goal = loadedContract.contract.goal;
    return {
      interrupted: true,
      directTaskGoal: goal,
      directTaskLikelyStale: planWorkflowActive,
      summary: planWorkflowActive
        ? `Direkte Aufgabe "${goal}" — ⚠ Plan-Workflow ist inzwischen aktiv, Contract vermutlich veraltet`
        : `Direkte Aufgabe unterbrochen: "${goal}"`,
    };
  }

  if (content === undefined) {
    return { interrupted: false, summary: "kein Plan — keine Recovery nötig" };
  }
  return {
    interrupted: false,
    phase,
    summary: `Plan-Phase '${phase}' — keine unterbrochene Aufgabe`,
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
 *
 * Branches on `status.directTaskGoal`: a plan candidate offers `/work` as the
 * resume path and discards the sidecar with a plan/hash/token-bound CAS (plan
 * content untouched); a direct-task candidate offers `/task-done` as the
 * resume path and discards via `clearTaskContract`.
 */
export async function offerRecoveryDialog(
  ctx: ExtensionContext,
  status: RecoveryStatus,
  exec: GateContext["exec"],
): Promise<"plan-state-discarded" | undefined> {
  if (!status.interrupted) return;
  const sessionId = ctx.sessionManager.getSessionId();
  const sessionIsCurrent = (): boolean =>
    ctx.sessionManager.getSessionId() === sessionId;

  const isDirectTask = status.directTaskGoal !== undefined;
  const initialPlanState = isDirectTask
    ? undefined
    : loadWorkflowState(ctx.cwd);
  const initialPlanHash =
    initialPlanState?.state?.planHash ??
    (() => {
      try {
        const plan = readPlanFile(ctx.cwd);
        return plan === undefined ? undefined : hashPlanContent(plan);
      } catch {
        return undefined;
      }
    })();
  const staleNote = isDirectTask
    ? status.directTaskLikelyStale
      ? " ⚠ Ein Plan-Workflow ist inzwischen aktiv; dieser Contract ist vermutlich veraltet."
      : ""
    : status.planStale
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
  if (!sessionIsCurrent()) return;

  switch (choice) {
    case RESUME_OPTION:
      ctx.ui.notify(
        isDirectTask
          ? "Arbeite normal weiter und nutze /task-done zum Abschließen der direkten Aufgabe."
          : "Nutze /work, um die pausierte oder blockierte Ausführung sicher fortzusetzen (verlangt dort eine eigene Bestätigung).",
        "info",
      );
      return;
    case DIFF_OPTION: {
      const result = await runVerificationGate({
        projectRoot: ctx.cwd,
        trusted: ctx.isProjectTrusted(),
        exec,
      });
      if (!sessionIsCurrent()) return;
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
      if (!sessionIsCurrent()) return;
      ctx.ui.notify(
        formatGateReport(result),
        result.status === "pass" ? "info" : "warning",
      );
      return;
    }
    case DISCARD_OPTION: {
      const confirmed = await ctx.ui.confirm(
        isDirectTask
          ? "Task-Contract der direkten Aufgabe wirklich verwerfen?"
          : "Workflow-Zustand wirklich verwerfen?",
        isDirectTask
          ? "Der Task-Contract wird entfernt. Diese Aktion ist nicht rückgängig zu machen."
          : "Der Sidecar-Zustand wird entfernt; der Plan-Inhalt selbst bleibt erhalten. Diese Aktion ist nicht rückgängig zu machen.",
      );
      if (!sessionIsCurrent()) return;
      if (!confirmed) {
        ctx.ui.notify("Verwerfen abgebrochen.", "info");
        return;
      }
      if (isDirectTask) {
        clearTaskContract(ctx.cwd);
        ctx.ui.notify("Task-Contract der direkten Aufgabe verworfen.", "info");
      } else {
        if (!initialPlanState || !initialPlanHash) {
          ctx.ui.notify(
            "Workflow-Zustand konnte nicht eindeutig gebunden werden; Verwerfen wurde abgebrochen.",
            "warning",
          );
          return;
        }
        try {
          removeWorkflowStateAtomicCAS(ctx.cwd, {
            stateToken: initialPlanState.stateToken,
            planHash: initialPlanHash,
            ...(initialPlanState.state?.planId
              ? { planId: initialPlanState.state.planId }
              : {}),
          });
        } catch (error) {
          ctx.ui.notify(
            `Workflow-Zustand hat sich während der Bestätigung geändert; Verwerfen wurde abgebrochen: ${error instanceof Error ? error.message : String(error)}`,
            "warning",
          );
          return;
        }
        ctx.ui.notify(
          "Workflow-Zustand verworfen. Der Plan-Inhalt ist unverändert.",
          "info",
        );
        return "plan-state-discarded";
      }
      return;
    }
    case NOTHING_OPTION:
    default:
      return;
  }
}
