/**
 * Command, tool and shortcut registration.
 *
 * Every handler validates its input and then calls exactly one controller —
 * the workflow logic itself lives in planning.ts, execution.ts,
 * completion-commands.ts, direct-task-commands.ts and maintenance-commands.ts.
 */
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import {
  buildWorkflowTab,
  type WorkflowAction,
} from "../shared/control-center-menu.ts";
import { runTabbedOverlay } from "../shared/tabbed-overlay.ts";
import { openAgentModelMenu } from "./agent-model-menu.ts";
import { openCommandCenter } from "./command-center.ts";
import { finishDirectTask, finishWorkflow } from "./completion-commands.ts";
import {
  beginDirectTask,
  resumeDirectTask,
  startDirectTask,
} from "./direct-task-commands.ts";
import { runRoute } from "./route-commands.ts";
import {
  completeStepsByNumber,
  parseStepNumbers,
  startWork,
  updateExecutionStep,
} from "./execution.ts";
import {
  discardPlan,
  migrateLegacyPlan,
  recoverWorkflowLock,
  runVerifyGate,
} from "./maintenance-commands.ts";
import { editPlanMarkdown, viewPlanMarkdown } from "./plan-editor.ts";
import {
  buildPlanAssistantTab,
  type PlanAssistantAction,
} from "./plan-assistant.ts";
import {
  activatePlanningMode,
  beginPlanning,
  beginReview,
  choosePlanKind,
} from "./planning.ts";
import { formatPlanSteps, workflowWarning } from "./presentation.ts";
import type { WorkflowSession } from "./session.ts";
import { loadDirectTask } from "./store/index.ts";

const STEP_STATUSES = ["in_progress", "completed", "blocked"] as const;
const PlanProgressParams = Type.Object({
  stepId: Type.String({
    minLength: 36,
    maxLength: 36,
    description: "Stabile PI-STEP-ID aus dem aktuellen Ausführungskontext",
  }),
  status: StringEnum(STEP_STATUSES),
  evidence: Type.String({ minLength: 1, maxLength: 1000 }),
});

function textResult(text: string, details: Record<string, unknown> = {}) {
  return {
    content: [{ type: "text" as const, text }],
    details,
  };
}

/** Manual evidence fallback: /done <n> [m …]. */
async function completeStepsCommand(
  session: WorkflowSession,
  ctx: ExtensionContext,
  args: string,
): Promise<void> {
  if (!ctx.isProjectTrusted()) {
    session.notify(
      ctx,
      "Harte Trust-Grenze: Fortschritt ist im untrusted Projekt blockiert.",
      "error",
    );
    return;
  }
  const loaded = session.reload(ctx);
  if (!loaded.snapshot || !loaded.state) {
    session.notify(ctx, "Kein aktiver Plan.", "warning");
    return;
  }
  const numbers = parseStepNumbers(args);
  if (numbers.length === 0) {
    const input = await ctx.ui.input(
      "Planschritte abschließen · /done",
      "Schrittnummern, z. B. 1 3 4",
    );
    const selected = parseStepNumbers(input ?? "");
    if (selected.length === 0) return;
    numbers.push(...selected);
  }
  const completed = completeStepsByNumber(
    loaded.snapshot,
    loaded.state,
    numbers,
  );
  if ("unknownStep" in completed) {
    session.notify(
      ctx,
      `Unbekannter Planschritt: ${completed.unknownStep}`,
      "warning",
    );
    return;
  }
  const state = session.replaceState(ctx, completed.state);
  if (state.status === "reviewing") await finishWorkflow(session, ctx, false);
}

async function openPlanAssistant(
  session: WorkflowSession,
  ctx: ExtensionContext,
): Promise<void> {
  const loaded = session.reload(ctx);
  const selected = await runTabbedOverlay<PlanAssistantAction>(
    ctx,
    "Plan-Assistent",
    [buildPlanAssistantTab(loaded)],
    { nonInteractiveHint: "Der Plan-Assistent benötigt den TUI-Modus." },
  );
  const action = selected?.entry.value;
  if (!action) return;

  switch (action) {
    case "new-simple":
      await beginPlanning(session, "simple_plan", ctx);
      return;
    case "new-detailed":
      await beginPlanning(session, "detailed_plan", ctx);
      return;
    case "revise":
      await beginPlanning(session, loaded.snapshot?.planType ?? "simple_plan", ctx);
      return;
    case "review":
      await beginReview(session, ctx);
      return;
    case "resume":
      await startWork(session, ctx);
      return;
    case "view":
      await viewPlanMarkdown(session, ctx);
      return;
    case "edit":
      await editPlanMarkdown(session, ctx);
      return;
    case "show-steps": {
      const current = session.reload(ctx);
      session.notify(
        ctx,
        current.snapshot && current.state
          ? formatPlanSteps(current.snapshot, current.state)
          : "Keine gültigen Planschritte vorhanden.",
        current.snapshot && current.state ? "info" : "warning",
      );
      return;
    }
    case "verify":
      await runVerifyGate(session, ctx);
      return;
    case "finish":
      await finishWorkflow(session, ctx, true);
      return;
    case "discard":
      await discardPlan(session, ctx);
      return;
    case "migrate":
      await migrateLegacyPlan(session, ctx);
      return;
  }
}

export function registerPlanCommands(
  pi: ExtensionAPI,
  session: WorkflowSession,
): void {
  pi.registerFlag("plan", {
    description: "Im Architekturplan-Modus starten",
    type: "boolean",
    default: false,
  });

  pi.registerCommand("plan", {
    description: "Zustandsabhängigen Plan-Assistenten öffnen oder Planart starten",
    handler: async (args, ctx) => {
      if (!args.trim()) {
        await openPlanAssistant(session, ctx);
        return;
      }
      const kind = await choosePlanKind(args, ctx);
      if (kind) await beginPlanning(session, kind, ctx);
    },
  });
  pi.registerCommand("review-plan", {
    description: "Aktuellen Plan optional vertieft prüfen",
    handler: async (_args, ctx) => beginReview(session, ctx),
  });
  pi.registerCommand("work", {
    description: "Bestätigten Plan ausführen oder explizit fortsetzen",
    handler: async (_args, ctx) => startWork(session, ctx),
  });
  pi.registerCommand("go", {
    description: "Alias für /work",
    handler: async (_args, ctx) => startWork(session, ctx),
  });
  pi.registerCommand("plan-todos", {
    description: "Stabile Planschritte und Sidecar-Status anzeigen",
    handler: async (_args, ctx) => {
      const loaded = session.reload(ctx);
      session.notify(
        ctx,
        loaded.snapshot && loaded.state
          ? formatPlanSteps(loaded.snapshot, loaded.state)
          : "Keine gültigen Planschritte vorhanden.",
        loaded.snapshot && loaded.state ? "info" : "warning",
      );
    },
  });
  pi.registerCommand("view-plan", {
    description: "Vollständigen Markdown-Plan im Terminal anzeigen",
    handler: async (_args, ctx) => viewPlanMarkdown(session, ctx),
  });
  pi.registerCommand("show-plan", {
    description: "Alias für /view-plan",
    handler: async (_args, ctx) => viewPlanMarkdown(session, ctx),
  });
  pi.registerCommand("edit-plan", {
    description:
      "Markdown-Plan direkt im Editor bearbeiten und Sidecar synchronisieren",
    handler: async (_args, ctx) => editPlanMarkdown(session, ctx),
  });
  pi.registerCommand("plan-edit", {
    description: "Alias für /edit-plan",
    handler: async (_args, ctx) => editPlanMarkdown(session, ctx),
  });
  pi.registerCommand("done", {
    description: "Planschritte manuell abschließen: /done <n> [m …]",
    handler: async (args, ctx) => completeStepsCommand(session, ctx, args),
  });
  pi.registerCommand("finish", {
    description:
      "Completion-Pipeline ausführen; TUI-Override nur mit Begründung",
    handler: async (_args, ctx) => finishWorkflow(session, ctx, true),
  });
  pi.registerCommand("discard-plan", {
    description: "Aktiven Plan und Sidecar ausdrücklich verwerfen",
    handler: async (_args, ctx) => discardPlan(session, ctx),
  });
  pi.registerCommand("task", {
    description: "Direktauftrag mit Scope und Abschlusskriterien starten",
    handler: async (args, ctx) => {
      if (args.trim()) {
        await startDirectTask(session, ctx, args);
        return;
      }
      if (loadDirectTask(ctx.cwd)) {
        await resumeDirectTask(session, ctx);
        return;
      }
      await beginDirectTask(session, ctx);
    },
  });
  pi.registerCommand("task-done", {
    description: "Direktauftrag über dieselbe Completion-Pipeline abschließen",
    handler: async (_args, ctx) => finishDirectTask(session, ctx),
  });
  pi.registerCommand("migrate-plan", {
    description: "Legacy-Workflow v1/v2 ausdrücklich nach v3 migrieren",
    handler: async (_args, ctx) => migrateLegacyPlan(session, ctx),
  });
  pi.registerCommand("recover-workflow-lock", {
    description: "Verwaisten Workflow-Lock nach Bestätigung entfernen",
    handler: async (_args, ctx) => recoverWorkflowLock(session, ctx),
  });
  pi.registerCommand("verify-gate", {
    description:
      "Completion-Prüfungen vorab ansehen; entscheidet nichts und schließt nichts ab",
    handler: async (_args, ctx) => runVerifyGate(session, ctx),
  });
  pi.registerCommand("route", {
    description:
      "Aufgaben-Routing anzeigen oder manuell stufen: /route [low|standard|high]",
    handler: async (args, ctx) => runRoute(session, ctx, args),
  });

  pi.registerTool({
    name: "plan_progress",
    label: "Plan Progress",
    description:
      "Schreibt ausschließlich Fortschritt zu einer stabilen Step-ID in den v3-Sidecar.",
    parameters: PlanProgressParams,
    executionMode: "sequential",
    async execute(_id, params, _signal, _onUpdate, ctx) {
      try {
        if (!ctx.isProjectTrusted()) {
          return textResult(
            "Fehler: Harte Trust-Grenze blockiert Fortschritt im untrusted Projekt.",
            { ok: false },
          );
        }
        const loaded = session.reload(ctx);
        if (!loaded.state || !loaded.snapshot) {
          return textResult("Fehler: Kein aktiver PlanSnapshot.", {
            ok: false,
          });
        }
        const updated = updateExecutionStep(loaded.state, {
          stepId: params.stepId,
          status: params.status,
          evidence: params.evidence,
        });
        session.replaceState(ctx, updated.state);
        return textResult(
          updated.allCompleted
            ? `T${updated.stepNumber} abgeschlossen; alle Schritte sind bereit für Completion.`
            : `T${updated.stepNumber} ist jetzt ${params.status}.`,
          {
            ok: true,
            stepId: params.stepId,
            status: params.status,
            allCompleted: updated.allCompleted,
          },
        );
      } catch (error) {
        return textResult(`Fehler: ${workflowWarning(error)}`, { ok: false });
      }
    },
  });

  const runWorkflowAction = async (
    action: WorkflowAction,
    ctx: ExtensionContext,
  ): Promise<void> => {
    switch (action) {
      case "simple_plan":
      case "detailed_plan":
        if (await activatePlanningMode(session, action, ctx)) {
          session.notify(
            ctx,
            `${action === "detailed_plan" ? "Architekturplan" : "Schnellplan"} aktiv. Beschreibe jetzt die Aufgabe.`,
          );
        }
        return;
      case "plan_work":
        await startWork(session, ctx);
        return;
      case "direct_task_start":
        await beginDirectTask(session, ctx);
        return;
      case "direct_task_continue":
        await resumeDirectTask(session, ctx);
        return;
    }
  };

  const menuState = (ctx: ExtensionContext) => {
    const loaded = session.reload(ctx);
    return {
      hasActivePlan: Boolean(loaded.snapshot && loaded.state),
      hasActiveDirectTask: Boolean(loadDirectTask(ctx.cwd)),
      activeMode: session.workflowMode(),
      migrationRequired: loaded.migrationRequired,
    };
  };

  const openWorkflowSwitch = async (ctx: ExtensionContext): Promise<void> => {
    const selected = await runTabbedOverlay<WorkflowAction>(
      ctx,
      "Workflow wechseln · /workflow",
      [buildWorkflowTab(menuState(ctx))],
      { nonInteractiveHint: "Der Workflow-Wechsel benötigt den TUI-Modus." },
    );
    const action = selected?.entry.value;
    if (action) await runWorkflowAction(action, ctx);
  };

  pi.registerCommand("workflow", {
    description: "Zustandsabhängigen Workflow-Wechsel öffnen",
    handler: async (_args, ctx) => openWorkflowSwitch(ctx),
  });
  pi.registerCommand("agent-models", {
    description: "Agentenmodelle für Planner, Worker und Reviewer anpassen",
    handler: async (_args, ctx) => openAgentModelMenu(pi, session, ctx),
  });
  pi.registerCommand("commands", {
    description: "Alle Slash-Commands nach Aufgabenbereich öffnen",
    handler: async (_args, ctx) => {
      await openCommandCenter(pi, ctx, menuState(ctx));
    },
  });
}
