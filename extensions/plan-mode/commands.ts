import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { catalogDescription } from "../shared/command-catalog.ts";
import { buildWorkflowEntries } from "../shared/control-center-menu.ts";
import { isPlanningMode, type WorkflowMode } from "../shared/workflow-mode.ts";
import { editPlanMarkdown, viewPlanMarkdown } from "./plan-editor.ts";
import { readPlan, removePlan } from "./plan-file.ts";
import { goHandoffPrompt } from "./prompts.ts";
import type { WorkflowSession } from "./session.ts";
import { openCommandCenter } from "./command-center.ts";

function requestedPlanMode(
  args: string,
): Exclude<WorkflowMode, "work"> | undefined {
  const value = args.trim().toLowerCase();
  if (["simple", "quick", "schnell"].includes(value)) return "simple_plan";
  if (["detailed", "architecture", "architektur"].includes(value))
    return "detailed_plan";
  return undefined;
}

async function selectPlanMode(
  ctx: ExtensionContext,
): Promise<Exclude<WorkflowMode, "work"> | undefined> {
  const choice = await ctx.ui.select("Planart", [
    "Schnellplan",
    "Architekturplan",
  ]);
  return choice === "Schnellplan"
    ? "simple_plan"
    : choice === "Architekturplan"
      ? "detailed_plan"
      : undefined;
}

export async function switchMode(
  session: WorkflowSession,
  mode: WorkflowMode,
  ctx: ExtensionContext,
): Promise<boolean> {
  if (mode === "work") {
    session.setMode(ctx, mode);
    return true;
  }
  if (!ctx.isProjectTrusted()) {
    session.notify(
      ctx,
      "Harte Trust-Grenze: Planmodus ist im untrusted Projekt blockiert.",
      "error",
    );
    return false;
  }
  session.setMode(ctx, mode);
  return true;
}

/**
 * The one workflow implementation behind every entry point (Shift+Tab /
 * /workflow, /plan, /work, /go): switching into a planning mode always
 * discards the stale plan and starts a fresh planning turn; switching into
 * work hands off the plan exactly once, only when the previous mode was a
 * planning mode — a plain work→work reselect or a mode that was already
 * work never resurrects a stale plan file.
 *
 * Returns whether a turn was actually started (planning turn or handoff),
 * so thin command wrappers can decide on their own user feedback without
 * owning any workflow logic themselves.
 */
export async function selectWorkflow(
  session: WorkflowSession,
  mode: WorkflowMode,
  ctx: ExtensionContext,
): Promise<boolean> {
  if (mode === "work") {
    const previousMode = session.selectedMode;
    await switchMode(session, "work", ctx);
    if (!isPlanningMode(previousMode)) return false;
    const plan = readPlan(ctx.cwd);
    if (!plan) return false;
    session.pi.sendMessage(
      {
        customType: "pi-plan-handoff",
        content: goHandoffPrompt(plan),
        display: true,
      },
      { triggerTurn: true },
    );
    return true;
  }

  if (!(await switchMode(session, mode, ctx))) return false;
  try {
    removePlan(ctx.cwd);
  } catch {
    session.notify(
      ctx,
      "Alter Plan konnte nicht sicher verworfen werden. Neuer Planning-Turn wurde nicht gestartet.",
      "error",
    );
    return false;
  }
  session.pi.sendMessage(
    {
      customType: "pi-plan-request",
      content:
        mode === "detailed_plan"
          ? "Erstelle jetzt den Architekturplan."
          : "Erstelle jetzt den Schnellplan.",
      display: true,
    },
    { triggerTurn: true },
  );
  return true;
}

export function registerPlanCommands(
  pi: ExtensionAPI,
  session: WorkflowSession,
): void {
  pi.registerCommand("plan", {
    description: catalogDescription("plan"),
    handler: async (args, ctx) => {
      const mode =
        requestedPlanMode(args) ??
        (args.trim() ? undefined : await selectPlanMode(ctx));
      if (!mode && args.trim()) {
        session.notify(
          ctx,
          "Verwendung: /plan simple|quick|detailed|architecture",
          "warning",
        );
        return;
      }
      if (mode) await selectWorkflow(session, mode, ctx);
    },
  });
  pi.registerCommand("work", {
    description: catalogDescription("work"),
    handler: async (_args, ctx) => {
      await selectWorkflow(session, "work", ctx);
    },
  });
  pi.registerCommand("go", {
    description: catalogDescription("go"),
    handler: async (_args, ctx) => {
      const didHandoff = await selectWorkflow(session, "work", ctx);
      if (!didHandoff && !readPlan(ctx.cwd)) {
        session.notify(
          ctx,
          "Kein aktueller Plan vorhanden. Nutze /plan oder arbeite direkt mit /work.",
          "info",
        );
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

  pi.registerCommand("workflow", {
    description: catalogDescription("workflow"),
    handler: async (_args, ctx) => {
      const entries = buildWorkflowEntries(session.selectedMode);
      const choice = await ctx.ui.select(
        "Workflow wechseln · /workflow",
        entries.map((entry) => entry.label),
      );
      const action = entries.find((entry) => entry.label === choice)?.value;
      if (action) await selectWorkflow(session, action, ctx);
    },
  });
  pi.registerCommand("commands", {
    description: catalogDescription("commands"),
    handler: async (_args, ctx) =>
      openCommandCenter(pi, ctx, { activeMode: session.selectedMode }),
  });
}
