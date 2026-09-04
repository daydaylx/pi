import { existsSync } from "node:fs";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isPlanningMode } from "../shared/workflow-mode.ts";
import {
  LEGACY_PLAN_RELATIVE_PATH,
  planPath,
  readLegacyWorkspacePlan,
  readPlan,
  writeWorkspacePlan,
} from "./plan-store.ts";
import type { WorkflowSession } from "./session.ts";

export async function viewPlanMarkdown(
  session: WorkflowSession,
  ctx: ExtensionContext,
): Promise<void> {
  const stored = readPlan(session.location(ctx));
  if (stored) {
    session.notify(ctx, stored.content, "info");
    return;
  }
  // A pre-session-scoping plan file is shown, clearly labelled, and never made
  // executable: a plan of unknown age must not become work just by existing.
  const legacy = readLegacyWorkspacePlan(ctx.cwd);
  if (legacy !== undefined) {
    session.notify(
      ctx,
      [
        `Kein Plan in dieser Sitzung. Gefunden wurde eine ältere Plandatei (${LEGACY_PLAN_RELATIVE_PATH}).`,
        "Sie wird nur angezeigt und nie automatisch ausgeführt. Übernimm sie bei Bedarf in einen neuen Planning-Turn.",
        "",
        legacy,
      ].join("\n"),
      "info",
    );
    return;
  }
  session.notify(ctx, "Kein aktueller Plan vorhanden.", "info");
}

/** Host editor only: no shell fallback can bypass the plan-mode policy. */
export async function editPlanMarkdown(
  session: WorkflowSession,
  ctx: ExtensionContext,
): Promise<void> {
  if (!ctx.isProjectTrusted()) {
    session.notify(
      ctx,
      "Harte Trust-Grenze: Planbearbeitung ist blockiert.",
      "error",
    );
    return;
  }
  const openEditor = (
    ctx.ui as typeof ctx.ui & {
      openExternalEditor?: (path: string) => Promise<void>;
    }
  ).openExternalEditor;
  if (!openEditor) {
    session.notify(
      ctx,
      "Der Host bietet keinen sicheren Plan-Editor an.",
      "warning",
    );
    return;
  }
  const path = planPath(session.location(ctx));
  if (!existsSync(path)) {
    session.notify(
      ctx,
      "Es gibt noch keinen Plan zum Bearbeiten. Starte zuerst einen Planning-Turn.",
      "info",
    );
    return;
  }
  await openEditor(path);
  // Editing invalidates any standing approval: it was bound to the old hash,
  // and consuming it now would hand over text the user never approved.
  session.clearApproval();
  // Readiness is bound to a hash too, and the edit just changed it. Without
  // resyncing here, an edited plan could never be approved again: the stored
  // hash and the stale readiness hash would disagree forever, since nothing
  // else re-derives readiness outside a planning turn. The caller already
  // checked isPlanningMode(session.selectedMode); this repeats it because
  // that guarantee lives in commands.ts, not in this module's own contract.
  if (isPlanningMode(session.selectedMode))
    session.refreshReadinessAfterEdit(ctx, session.selectedMode);
}

/**
 * Opt-in copy into the checkout, for a plan the user wants to keep or share.
 *
 * Guarded only by the trust boundary, not by the permission-level or
 * recovery-gate machinery in extensions/permissions/guards.ts. That is
 * deliberate, not an oversight: those guards police the agent's own
 * `tool_call` events; a slash command is a human-initiated action running
 * with the extension's own privileges, the same footing every other
 * state-changing command here has (`/permission`, `/yolo`, `/edit-plan`'s
 * external-editor write). The recovery gate specifically exists to stop an
 * *agent* write after an unverified interruption; a person choosing to save
 * their own already-reviewed plan text is a different action than that.
 */
export async function savePlanToWorkspace(
  session: WorkflowSession,
  ctx: ExtensionContext,
): Promise<void> {
  if (!ctx.isProjectTrusted()) {
    session.notify(
      ctx,
      "Harte Trust-Grenze: Im nicht vertrauenswürdigen Projekt wird nichts geschrieben.",
      "error",
    );
    return;
  }
  const stored = readPlan(session.location(ctx));
  if (!stored) {
    session.notify(ctx, "Kein Plan in dieser Sitzung.", "info");
    return;
  }
  const path = writeWorkspacePlan(ctx.cwd, stored.content);
  session.notify(
    ctx,
    `Plan zusätzlich im Workspace gespeichert: ${path}. Die Sitzungsablage bleibt die maßgebliche Quelle.`,
  );
}
