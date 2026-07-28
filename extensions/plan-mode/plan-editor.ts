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
} from "./store/index.ts";
import { finalizePlanDocument } from "./plan-snapshot.ts";

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

  try {
    const finalized = finalizePlanDocument(
      editedContent,
      loaded.snapshot.planType,
      initialContent,
    );

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
    // Revert edits on disk to prevent corrupted state
    try {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(path, initialContent, "utf8");
    } catch {
      // Ignore fallback write errors
    }

    session.notify(
      ctx,
      `Plan-Validierung fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}. Änderungen wurden zurückgesetzt.`,
      "error",
    );
  }
}
