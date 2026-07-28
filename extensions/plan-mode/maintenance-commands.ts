/**
 * Destructive and recovery commands: /discard-plan, /migrate-plan and
 * /recover-workflow-lock.
 *
 * All three share one shape — hard trust boundary, explicit TUI confirmation,
 * then a single store call. None of them ever runs implicitly or on a timer:
 * legacy state is never silently migrated and a lock is never taken over
 * automatically (Umbauvertrag §13.5).
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { updateWorkflowPresentation, workflowWarning } from "./presentation.ts";
import type { WorkflowSession } from "./session.ts";
import {
  clearWorkflowLockAfterConfirmation,
  discardActiveWorkflow,
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
