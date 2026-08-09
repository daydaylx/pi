import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { catalogDescription } from "../shared/command-catalog.ts";
import { buildWorkflowEntries } from "../shared/control-center-menu.ts";
import { isPlanningMode, type WorkflowMode } from "../shared/workflow-mode.ts";
import { editPlanMarkdown, viewPlanMarkdown } from "./plan-editor.ts";
import type { WorkflowSession } from "./session.ts";
import { openCommandCenter } from "./command-center.ts";

export async function switchMode(
  session: WorkflowSession,
  mode: WorkflowMode,
  ctx: ExtensionContext,
): Promise<boolean> {
  if (isPlanningMode(mode)) {
    if (!ctx.isProjectTrusted()) {
      session.notify(
        ctx,
        "Harte Trust-Grenze: Planmodus ist im untrusted Projekt blockiert.",
        "error",
      );
      return false;
    }
    // Selecting a new plan mode must not make an older completed plan
    // eligible for a later work handoff.
    session.clearPlanHandoff();
  }
  session.setMode(ctx, mode);
  return true;
}

export async function openWorkflowMenu(
  session: WorkflowSession,
  ctx: ExtensionContext,
): Promise<void> {
  const entries = buildWorkflowEntries(session.selectedMode);
  const choice = await ctx.ui.select(
    "Workflow wechseln",
    entries.map((entry) => entry.label),
  );
  const action = entries.find((entry) => entry.label === choice)?.value;
  // This is the only workflow UI: it changes context but leaves the editor
  // idle, so the following turn can only come from a real user prompt.
  if (action) await switchMode(session, action, ctx);
}

export function registerPlanCommands(
  pi: ExtensionAPI,
  session: WorkflowSession,
): void {
  let workflowMenuOpen = false;
  pi.registerShortcut("shift+tab", {
    description: "Workflow wechseln",
    handler: async (ctx: ExtensionContext) => {
      if (workflowMenuOpen) return;
      workflowMenuOpen = true;
      try {
        await openWorkflowMenu(session, ctx);
      } catch (error) {
        session.notify(
          ctx,
          `Workflow-Auswahl fehlgeschlagen: ${
            error instanceof Error ? error.message : String(error)
          }`,
          "error",
        );
      } finally {
        workflowMenuOpen = false;
      }
    },
  });
  pi.registerCommand("view-plan", {
    description: catalogDescription("view-plan"),
    handler: async (_args, ctx) => viewPlanMarkdown(session, ctx),
  });
  pi.registerCommand("show-plan", {
    description: "Alias für /view-plan",
    handler: async (_args, ctx) => viewPlanMarkdown(session, ctx),
  });
  pi.registerCommand("edit-plan", {
    description: catalogDescription("edit-plan"),
    handler: async (_args, ctx) => {
      if (!isPlanningMode(session.selectedMode)) {
        session.notify(
          ctx,
          "/edit-plan ist nur im Planmodus verfügbar.",
          "warning",
        );
        return;
      }
      await editPlanMarkdown(session, ctx);
    },
  });
  pi.registerCommand("plan-edit", {
    description: "Alias für /edit-plan",
    handler: async (_args, ctx) => {
      if (!isPlanningMode(session.selectedMode)) {
        session.notify(
          ctx,
          "/plan-edit ist nur im Planmodus verfügbar.",
          "warning",
        );
        return;
      }
      await editPlanMarkdown(session, ctx);
    },
  });

  pi.registerCommand("commands", {
    description: catalogDescription("commands"),
    handler: async (_args, ctx) =>
      openCommandCenter(pi, ctx, { activeMode: session.selectedMode }),
  });
}
