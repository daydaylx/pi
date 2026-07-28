/**
 * Maintenance commands: /discard-plan, /migrate-plan, /recover-workflow-lock
 * and the read-only /verify-gate diagnosis.
 *
 * The three destructive ones share one shape — hard trust boundary, explicit
 * TUI confirmation, then a single store call. None of them ever runs implicitly
 * or on a timer: legacy state is never silently migrated and a lock is never
 * taken over automatically (Umbauvertrag §13.5).
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  diagnoseCompletion,
  formatCompletionDiagnosis,
} from "./completion/index.ts";
import { updateWorkflowPresentation, workflowWarning } from "./presentation.ts";
import type { WorkflowSession } from "./session.ts";
import {
  clearWorkflowLockAfterConfirmation,
  discardActiveWorkflow,
  loadDirectTask,
  migrateLegacyWorkflowToV3,
} from "./store/index.ts";

function denyUntrusted(
  session: WorkflowSession,
  ctx: ExtensionContext,
  action: string,
): boolean {
  if (ctx.isProjectTrusted()) return false;
  session.notify(
    ctx,
    `Harte Trust-Grenze: ${action} ist im untrusted Projekt blockiert.`,
    "error",
  );
  return true;
}

export async function discardPlan(
  session: WorkflowSession,
  ctx: ExtensionContext,
): Promise<void> {
  if (denyUntrusted(session, ctx, "Verwerfen")) return;
  const loaded = session.reload(ctx);
  if (!loaded.planContent && !loaded.state) {
    session.notify(ctx, "Kein aktiver Workflow vorhanden.");
    return;
  }
  const confirmed = await ctx.ui.confirm(
    "Aktiven Plan verwerfen?",
    "Plan, Sidecar und unarchivierter Completion-Report werden entfernt. Diese Aktion ist nicht automatisch rückgängig.",
  );
  if (!confirmed) return;
  try {
    discardActiveWorkflow(ctx.cwd, loaded.stateToken, true);
    session.current = {
      stateToken: "missing",
      recovered: false,
      migrationRequired: false,
      warnings: [],
    };
    updateWorkflowPresentation(ctx);
    session.notify(ctx, "Aktiver Plan und Sidecar wurden entfernt.", "warning");
  } catch (error) {
    session.notify(ctx, workflowWarning(error), "error");
  }
}

export async function migrateLegacyPlan(
  session: WorkflowSession,
  ctx: ExtensionContext,
): Promise<void> {
  if (denyUntrusted(session, ctx, "Migration")) return;
  const confirmed = await ctx.ui.confirm(
    "Legacy-Workflow migrieren?",
    "Bestätige nur, wenn alle älteren Pi-Sessions für dieses Projekt geschlossen sind. Vorher wird ein Backup angelegt.",
  );
  if (!confirmed) return;
  try {
    session.current = migrateLegacyWorkflowToV3(ctx.cwd, {
      confirmedLegacySessionsClosed: true,
    });
    updateWorkflowPresentation(ctx, session.current.state);
    session.notify(ctx, session.current.warnings.join("\n"));
  } catch (error) {
    session.notify(ctx, workflowWarning(error), "error");
  }
}

/**
 * Preview the completion checks without deciding anything.
 *
 * Uses the same check functions and the same classification as the binding
 * pipeline; it writes no state, calls no reviewer and produces no report, so
 * it can never become a second way to finish a task.
 */
export async function runVerifyGate(
  session: WorkflowSession,
  ctx: ExtensionContext,
): Promise<void> {
  if (typeof ctx.isIdle === "function" && !ctx.isIdle()) {
    session.notify(
      ctx,
      "/verify-gate ist erst nach Abschluss des laufenden Agent-Turns verfügbar.",
      "warning",
    );
    return;
  }
  try {
    const loaded = session.reload(ctx);
    const directTask = loadDirectTask(ctx.cwd);
    const diagnosis = await diagnoseCompletion({
      projectRoot: ctx.cwd,
      trusted: ctx.isProjectTrusted(),
      exec: (program, args, options) =>
        session.pi.exec(program, args, {
          cwd: options.cwd,
          timeout: options.timeout,
          signal: options.signal as AbortSignal | undefined,
        }),
      ...(loaded.snapshot ? { plan: loaded.snapshot } : {}),
      ...(directTask ? { directTask } : {}),
    });
    session.notify(
      ctx,
      formatCompletionDiagnosis(diagnosis),
      diagnosis.status === "pass" ? "info" : "warning",
    );
  } catch (error) {
    session.notify(
      ctx,
      `Verifikations-Diagnose fehlgeschlagen: ${workflowWarning(error)}`,
      "error",
    );
  }
}

export async function recoverWorkflowLock(
  session: WorkflowSession,
  ctx: ExtensionContext,
): Promise<void> {
  if (denyUntrusted(session, ctx, "Lock-Recovery")) return;
  const confirmed = await ctx.ui.confirm(
    "Workflow-Lock entfernen?",
    "Nur bestätigen, wenn kein anderer Pi-Prozess diesen Workflow bearbeitet.",
  );
  if (!confirmed) return;
  try {
    clearWorkflowLockAfterConfirmation(ctx.cwd, true);
    session.notify(ctx, "Workflow-Lock entfernt.");
  } catch (error) {
    session.notify(ctx, workflowWarning(error), "error");
  }
}
