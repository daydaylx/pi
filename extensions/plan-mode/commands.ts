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
import { CONTROL_CENTER_EVENTS } from "../shared/control-center-events.ts";
import {
  buildControlCenterTabs,
  buildWorkflowTab,
  type ControlCenterAction,
} from "../shared/control-center-menu.ts";
import { SHORTCUTS } from "../shared/shortcuts.ts";
import { runTabbedOverlay } from "../shared/tabbed-overlay.ts";
import { finishDirectTask, finishWorkflow } from "./completion-commands.ts";
import { startDirectTask } from "./direct-task-commands.ts";
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
import { openModelMenu } from "./model-menu.ts";
import { beginPlanning, beginReview, choosePlanKind } from "./planning.ts";
import { formatPlanSteps, workflowWarning } from "./presentation.ts";
import type { WorkflowSession } from "./session.ts";

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
    session.notify(ctx, "Verwendung: /done <n> [m …]", "warning");
    return;
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
    description: "Schnell- oder Architekturplan erstellen",
    handler: async (args, ctx) => {
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
    description: "Direkte Aufgabe mit Scope und Abschlusskriterien starten",
    handler: async (args, ctx) => startDirectTask(session, ctx, args),
  });
  pi.registerCommand("task-done", {
    description: "Direct Task über dieselbe Completion-Pipeline abschließen",
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

  pi.registerShortcut(SHORTCUTS.modelMenu.keys, {
    description: SHORTCUTS.modelMenu.description,
    handler: async (ctx) => await openModelMenu(pi, ctx),
  });
  // Without this listener the Hauptmenü "Modelle" entry emitted into the void.
  pi.events.on(CONTROL_CENTER_EVENTS.openModels, async (event) => {
    const ctx = (event as { ctx?: ExtensionContext }).ctx;
    if (ctx) await openModelMenu(pi, ctx);
  });

  pi.registerShortcut(SHORTCUTS.planAssistant.keys, {
    description: SHORTCUTS.planAssistant.description,
    handler: async (ctx) => {
      const kind = await choosePlanKind("", ctx);
      if (kind) await beginPlanning(session, kind, ctx);
    },
  });
  // The one action router. Both entry points end here, so an entry can never
  // mean something different depending on which key opened it.
  const runControlCenterAction = async (
    action: ControlCenterAction,
    ctx: ExtensionContext,
  ): Promise<void> => {
    switch (action) {
      case "simple_plan":
      case "detailed_plan":
        await beginPlanning(session, action, ctx);
        return;
      case "work":
        await startWork(session, ctx);
        return;
      case "permissions":
        pi.events.emit(CONTROL_CENTER_EVENTS.openPermissions, { ctx });
        return;
      case "models":
        pi.events.emit(CONTROL_CENTER_EVENTS.openModels, { ctx });
        return;
      case "thinking":
        pi.events.emit(CONTROL_CENTER_EVENTS.openThinking, { ctx });
        return;
      case "diagnostics":
        pi.events.emit(CONTROL_CENTER_EVENTS.openDiagnostics, { ctx });
        return;
    }
  };

  const menuState = (ctx: ExtensionContext) => {
    const loaded = session.reload(ctx);
    return {
      hasActiveWorkflow: Boolean(loaded.snapshot && loaded.state),
      activeMode: session.workflowMode(),
    };
  };

  /** Shift+Tab: the workflow switch. */
  const openWorkflowSwitch = async (ctx: ExtensionContext): Promise<void> => {
    const selected = await runTabbedOverlay<ControlCenterAction>(
      ctx,
      "Workflow wechseln",
      [buildWorkflowTab(menuState(ctx))],
      { nonInteractiveHint: "Der Workflow-Wechsel benötigt den TUI-Modus." },
    );
    const action = selected?.entry.value;
    if (action) await runControlCenterAction(action, ctx);
  };

  /** Super+Q: the full Control Center, starting with that same workflow tab. */
  const openControlCenter = async (ctx: ExtensionContext): Promise<void> => {
    const selected = await runTabbedOverlay<ControlCenterAction>(
      ctx,
      "Control Center",
      buildControlCenterTabs(menuState(ctx)),
      { nonInteractiveHint: "Das Control Center benötigt den TUI-Modus." },
    );
    const action = selected?.entry.value;
    if (action) await runControlCenterAction(action, ctx);
  };

  pi.registerShortcut(SHORTCUTS.modeMenu.keys, {
    description: SHORTCUTS.modeMenu.description,
    handler: openWorkflowSwitch,
  });
  pi.events.on(CONTROL_CENTER_EVENTS.open, async (event) => {
    const ctx = (event as { ctx?: ExtensionContext }).ctx;
    if (ctx) await openControlCenter(ctx);
  });
}
