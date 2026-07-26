/** Registration boundary for the stable plan-entry commands and shortcuts. */
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { CONTROL_CENTER_EVENTS } from "../shared/control-center-events.ts";
import { SHORTCUTS } from "../shared/shortcuts.ts";

export interface PlanEntryCommandHandlers {
  routePlan(ctx: ExtensionContext): Promise<void>;
  showPlanTodos(ctx: ExtensionContext): void;
  runDecisionIntake(ctx: ExtensionContext): Promise<void>;
  openControlCenter(ctx: ExtensionContext): Promise<void>;
  openModelScopes(ctx: ExtensionContext): Promise<void>;
}

export function registerPlanEntryCommands(
  pi: ExtensionAPI,
  handlers: PlanEntryCommandHandlers,
): void {
  pi.registerFlag("plan", {
    description:
      "Im detaillierten Planungsmodus starten (Berechtigungen unverändert)",
    type: "boolean",
    default: false,
  });

  pi.registerCommand("plan", {
    description: "Plan-Assistent öffnen (zustandsabhängig)",
    handler: async (_args, ctx) => handlers.routePlan(ctx),
  });
  pi.registerCommand("plan-todos", {
    description: "Todos aus der aktuellen Plan-Datei anzeigen",
    handler: async (_args, ctx) => handlers.showPlanTodos(ctx),
  });
  pi.registerCommand("decide", {
    description: "Decision-Intake starten (Optionen klären → Decision Brief)",
    handler: async (_args, ctx) => handlers.runDecisionIntake(ctx),
  });

  pi.registerShortcut(SHORTCUTS.planAssistant.keys, {
    description: SHORTCUTS.planAssistant.description,
    handler: async (ctx) => handlers.routePlan(ctx),
  });
  pi.registerShortcut(SHORTCUTS.modeMenu.keys, {
    description: SHORTCUTS.modeMenu.description,
    handler: async (ctx) => handlers.openControlCenter(ctx),
  });
  pi.registerShortcut(SHORTCUTS.modelMenu.keys, {
    description: SHORTCUTS.modelMenu.description,
    handler: async (ctx) => handlers.openModelScopes(ctx),
  });
  pi.events.on(CONTROL_CENTER_EVENTS.openModels, async (event) => {
    await handlers.openModelScopes((event as { ctx: ExtensionContext }).ctx);
  });
}
