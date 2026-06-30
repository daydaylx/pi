import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  extractTodoItems,
  readPlanFile,
} from "./plan-mode/utils.ts";
import type { WorkflowPhase } from "./shared/workflow-status.ts";

interface PersistedPlanState {
  phase?: WorkflowPhase;
}

export interface ActionMenuState {
  phase: WorkflowPhase;
  planExists: boolean;
  completedTodos: number;
  totalTodos: number;
  gitDirty: boolean;
  availableCommands: ReadonlySet<string>;
  configValidationAvailable: boolean;
}

export interface ActionMenuItem {
  id: string;
  label: string;
  command: string;
}

function latestPlanPhase(
  entries: ReturnType<ExtensionCommandContext["sessionManager"]["getBranch"]>,
): WorkflowPhase | undefined {
  for (const entry of [...entries].reverse()) {
    if (entry.type !== "custom" || entry.customType !== "plan-mode") continue;
    const data = entry.data as PersistedPlanState | undefined;
    if (data?.phase) return data.phase;
  }
  return undefined;
}

function hasConfigValidation(cwd: string): boolean {
  const scriptPath = join(cwd, "scripts", "config.mjs");
  const packagePath = join(cwd, "package.json");
  if (!existsSync(scriptPath) || !existsSync(packagePath)) return false;

  try {
    const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as {
      scripts?: Record<string, unknown>;
    };
    return typeof packageJson.scripts?.["config:validate"] === "string";
  } catch {
    return false;
  }
}

export function buildActionMenu(state: ActionMenuState): ActionMenuItem[] {
  const actions: ActionMenuItem[] = [];

  if (!state.planExists) {
    actions.push({
      id: "plan",
      label: "Plan erstellen — /plan",
      command: "/plan",
    });
  } else {
    actions.push({
      id: "review",
      label:
        state.phase === "draft"
          ? "Plan prüfen (empfohlen) — /review-plan"
          : "Plan erneut prüfen — /review-plan",
      command: "/review-plan",
    });

    if (state.phase === "reviewed") {
      actions.push({
        id: "go",
        label: "Plan ausführen — /go",
        command: "/go",
      });
    }

    actions.push({
      id: "finish",
      label:
        state.phase === "ready"
          ? "Plan abschließen — /finish"
          : "Plan archivieren/abschließen — /finish",
      command: "/finish",
    });
  }

  if (state.totalTodos > 0) {
    actions.push({
      id: "todos",
      label: `Todo-Liste anzeigen (${state.completedTodos}/${state.totalTodos}) — /plan-todos`,
      command: "/plan-todos",
    });
  }

  if (state.availableCommands.has("tools")) {
    actions.push({
      id: "tools",
      label: "Tools konfigurieren — /tools",
      command: "/tools",
    });
  }

  actions.push({
    id: "model",
    label: "Modell wechseln — /model",
    command: "/model",
  });

  if (state.availableCommands.has("scroll")) {
    actions.push({
      id: "sessions",
      label: "Session suchen — /scroll",
      command: "/scroll",
    });
  }

  if (state.gitDirty && state.availableCommands.has("show-diffs")) {
    actions.push({
      id: "diff",
      label: "Diff anzeigen — /show-diffs",
      command: "/show-diffs",
    });
  }

  if (state.configValidationAvailable) {
    actions.push({
      id: "validate",
      label: "Config prüfen — npm run config:validate",
      command: "!npm run config:validate",
    });
  }

  if (state.availableCommands.has("home")) {
    actions.push({
      id: "home",
      label: "Dashboard anzeigen — /home",
      command: "/home",
    });
  }
  if (state.availableCommands.has("dashboard")) {
    actions.push({
      id: "dashboard",
      label: "Dashboard-Autostart umschalten — /dashboard",
      command: "/dashboard",
    });
  }

  return actions;
}

async function collectState(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
): Promise<ActionMenuState> {
  let planContent: string | undefined;
  try {
    planContent = readPlanFile(ctx.cwd);
  } catch {
    planContent = undefined;
  }
  const todos = planContent ? extractTodoItems(planContent) : [];
  const persistedPhase = latestPlanPhase(ctx.sessionManager.getBranch());

  let gitDirty = false;
  try {
    const result = await pi.exec(
      "git",
      ["status", "--short", "--untracked-files=normal"],
      { cwd: ctx.cwd, timeout: 5_000 },
    );
    gitDirty = result.code === 0 && result.stdout.trim().length > 0;
  } catch {
    gitDirty = false;
  }

  return {
    phase: planContent ? (persistedPhase ?? "draft") : "idle",
    planExists: planContent !== undefined,
    completedTodos: todos.filter((todo) => todo.completed).length,
    totalTodos: todos.length,
    gitDirty,
    availableCommands: new Set(pi.getCommands().map((command) => command.name)),
    configValidationAvailable: hasConfigValidation(ctx.cwd),
  };
}

async function putCommandInEditor(
  command: string,
  ctx: ExtensionCommandContext,
): Promise<void> {
  const existing = ctx.ui.getEditorText().trim();
  if (existing && existing !== command) {
    const replace = await ctx.ui.confirm(
      "Editorinhalt ersetzen?",
      `Der aktuelle Entwurf wird durch ${command} ersetzt.`,
    );
    if (!replace) return;
  }

  ctx.ui.setEditorText(command);
  ctx.ui.notify("Befehl vorbereitet. Enter führt ihn aus.", "info");
}

export default function actionsExtension(pi: ExtensionAPI): void {
  pi.registerCommand("actions", {
    description: "Kontextabhängiges Aktionsmenü öffnen",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("/actions benötigt den TUI-Modus.", "error");
        return;
      }

      const state = await collectState(pi, ctx);
      const actions = buildActionMenu(state);
      if (actions.length === 0) {
        ctx.ui.notify("Keine passende Aktion verfügbar.", "info");
        return;
      }

      const choice = await ctx.ui.select(
        "Nächste Aktion wählen",
        actions.map((action) => action.label),
      );
      const selected = actions.find((action) => action.label === choice);
      if (!selected) return;
      await putCommandInEditor(selected.command, ctx);
    },
  });
}
