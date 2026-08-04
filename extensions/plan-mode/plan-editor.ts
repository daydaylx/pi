import { existsSync, readFileSync } from "node:fs";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { planPath } from "./plan-file.ts";
import type { WorkflowSession } from "./session.ts";

export async function viewPlanMarkdown(
  session: WorkflowSession,
  ctx: ExtensionContext,
): Promise<void> {
  const path = planPath(ctx.cwd);
  if (!existsSync(path)) {
    session.notify(ctx, "Kein aktueller Plan vorhanden.", "info");
    return;
  }
  session.notify(ctx, readFileSync(path, "utf8"), "info");
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
  await openEditor(planPath(ctx.cwd));
}
