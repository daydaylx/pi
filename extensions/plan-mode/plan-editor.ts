/**
 * Modular Plan Editor & Viewer for Plan Mode (v3).
 *
 * Provides direct Markdown viewing and manual editing capability for
 * `.agent/plans/current-plan.md` with automatic CAS sidecar synchronization.
 */

import { existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { WorkflowSession } from "./session.ts";
import {
  PLAN_RELATIVE_PATH,
  finalizeObservedPlanCAS,
  workflowPath,
  type WorkflowStateV3,
} from "./store/index.ts";
import type { PlanSnapshot } from "./plan-snapshot.ts";
import { finalizePlanDocument } from "./plan-snapshot.ts";
import { workflowWarning } from "./presentation.ts";

/**
 * Renders the active plan's Markdown content cleanly in the TUI / terminal.
 */
export async function viewPlanMarkdown(
  session: WorkflowSession,
  ctx: ExtensionContext,
): Promise<void> {
  const loaded = session.reload(ctx);
  const path = workflowPath(ctx.cwd, PLAN_RELATIVE_PATH);
  if (!loaded.snapshot || !existsSync(path)) {
    session.notify(
      ctx,
      "Kein aktiver Plan zum Anzeigen vorhanden. Starte zuerst einen Plan mit /plan.",
      "warning",
    );
    return;
  }

  const content = readFileSync(path, "utf8");
  const stepCount = loaded.snapshot.steps.length;
  const header = `=== AKTUELLER PLAN (Revision ${loaded.snapshot.planRevision}, ${stepCount} Schritte) ===\n`;
  session.notify(ctx, `${header}\n${content}`, "info");
}

/**
 * Opens `.agent/plans/current-plan.md` for direct manual editing using $EDITOR,
 * and synchronizes sidecar via finalizePlanDocument + finalizeObservedPlanCAS.
 */
export async function editPlanMarkdown(
  session: WorkflowSession,
  ctx: ExtensionContext,
): Promise<void> {
  if (!ctx.isProjectTrusted()) {
    session.notify(
      ctx,
      "Harte Trust-Grenze: Planbearbeitung ist im untrusted Projekt blockiert.",
      "error",
    );
    return;
  }
  const loaded = session.reload(ctx);
  const path = workflowPath(ctx.cwd, PLAN_RELATIVE_PATH);

  if (!loaded.snapshot || !loaded.state || !existsSync(path)) {
    session.notify(
      ctx,
      "Kein aktiver Plan zum Bearbeiten vorhanden. Starte zuerst einen Plan mit /plan.",
      "warning",
    );
    return;
  }

  const initialContent = readFileSync(path, "utf8");
  let editedContent: string | undefined;

  const uiAny = ctx.ui as unknown as Record<string, unknown>;
  if (typeof uiAny.openExternalEditor === "function") {
    try {
      await (uiAny.openExternalEditor as (p: string) => Promise<void>)(path);
      editedContent = readFileSync(path, "utf8");
    } catch {
      editedContent = undefined;
    }
  }

  if (editedContent === undefined) {
    const editorCmd = process.env.EDITOR || process.env.VISUAL || "nano";
    try {
      execSync(`${editorCmd} "${path}"`, { stdio: "inherit" });
      editedContent = readFileSync(path, "utf8");
    } catch (error) {
      session.notify(
        ctx,
        `Konnte Editor (${editorCmd}) nicht öffnen: ${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
      return;
    }
  }

  if (!editedContent || editedContent.trim() === initialContent.trim()) {
    session.notify(ctx, "Keine Änderungen am Plan vorgenommen.", "info");
    return;
  }

  let finalized: ReturnType<typeof finalizePlanDocument>;
  try {
    finalized = finalizePlanDocument(
      editedContent,
      loaded.snapshot.planType,
      initialContent,
    );
  } catch (error) {
    const restored = restoreAfterFailedEdit(
      session,
      ctx,
      editedContent,
      loaded.snapshot,
      loaded.stateToken,
      loaded.state,
    );
    session.notify(
      ctx,
      `Markdown ungültig: ${workflowWarning(error)}. ${
        restored
          ? "Der Editorstand wurde sicher zurückgesetzt."
          : "Deine Bearbeitung ist unverändert in der Datei erhalten geblieben, wurde aber nicht als Planrevision übernommen. Prüfe den Inhalt mit /view-plan und starte bei Bedarf /edit-plan erneut."
      }`,
      "error",
    );
    return;
  }

  try {
    finalizeObservedPlanCAS(
      ctx.cwd,
      editedContent,
      finalized.snapshot,
      loaded.stateToken,
      loaded.state,
    );

    session.reload(ctx);
    session.notify(
      ctx,
      `Plan manuell aktualisiert (Revision ${finalized.metadata.planRevision}, ${finalized.snapshot.steps.length} Schritte synchronisiert).`,
      "info",
    );
  } catch (error) {
    const restored = restoreAfterFailedEdit(
      session,
      ctx,
      editedContent,
      loaded.snapshot,
      loaded.stateToken,
      loaded.state,
    );
    session.notify(
      ctx,
      `Nebenläufige Änderung erkannt: ${workflowWarning(error)}. ${
        restored
          ? "Der Editorstand wurde sicher zurückgesetzt."
          : "Deine Bearbeitung wurde nicht übernommen; lade den aktuellen Stand mit /view-plan, bevor du erneut bearbeitest."
      }`,
      "error",
    );
  }
}

/**
 * Reverts the plan file to `previousSnapshot` when a failed edit needs to be
 * undone. This always goes through the same CAS check as an intentional
 * write: if the plan or sidecar moved on since `stateToken`/`state` were
 * observed, a concurrent writer already won and nothing is overwritten. There
 * is no bypass — writing `previousSnapshot` unconditionally would overwrite
 * that concurrent revision and break the plan/state hash binding CAS exists
 * to protect (see `finalizeObservedPlanCAS`). The user's own edit is never
 * lost either way, since $EDITOR already saved it to disk before this runs.
 */
function restoreAfterFailedEdit(
  session: WorkflowSession,
  ctx: ExtensionContext,
  editedContent: string,
  previousSnapshot: PlanSnapshot,
  stateToken: string,
  state: WorkflowStateV3 | undefined,
): boolean {
  try {
    finalizeObservedPlanCAS(
      ctx.cwd,
      editedContent,
      previousSnapshot,
      stateToken,
      state,
    );
    session.reload(ctx);
    return true;
  } catch {
    // A concurrent writer won, or the lock/write itself failed. Either way,
    // the canonical file is left exactly as $EDITOR saved it.
    return false;
  }
}
