/**
 * UX-Status Extension
 *
 * Bündelt kleine, rein informative UX-Features, die keine Plan-/Policy-
 * Logik verändern:
 *   - /status (+ /home als Alias, auch über STATUS_REQUEST_EVENT aus dem
 *     Ctrl+Shift+X-Befehlsmenü erreichbar): kompakter Überblick über Mode,
 *     Modell, Thinking-Level, Plan-/Todo-Stand, Git-Zustand und
 *     Permission-Status.
 *   - /thinking + Ctrl+Shift+T: Thinking-Level setzen (Minimal…XHigh).
 *   - Ctrl+Shift+H: kompakte Shortcut-/Command-Hilfe, die nur tatsächlich
 *     registrierte Commands zeigt (dynamisch geprüft wie im zentralen Menü
 *     in actions.ts).
 *   - Deutsches Label für eingeklappte Thinking-Blöcke.
 *
 * Plan-Phase und Mode werden nicht neu berechnet, sondern über
 * WORKFLOW_STATUS_EVENT aus plan-mode und mode-permissions mitgelesen.
 */

import { execSync } from "node:child_process";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { runMenu } from "./shared/menu-ui.ts";
import { buildThinkingMenu, THINKING_LEVELS } from "./shared/thinking-menu.ts";
import {
  PERMISSION_LEVEL_LABEL,
  STATUS_REQUEST_EVENT,
  WORKFLOW_MODE_LABEL,
  WORKFLOW_STATUS_EVENT,
  type PermissionLevel,
  type StatusRequest,
  type WorkflowMode,
  type WorkflowPhase,
  type WorkflowStatusEvent,
} from "./shared/workflow-status.ts";

// Commands, die in der Ctrl+Shift+H-Hilfe auftauchen dürfen, sofern sie
// tatsächlich registriert sind. `native: true` markiert feste Pi-Commands,
// die NICHT über pi.getCommands() auffindbar sind (siehe dort), aber
// garantiert existieren.
const HELP_COMMANDS = [
  { name: "plan", command: "/plan" },
  { name: "work", command: "/work" },
  { name: "go", command: "/go" },
  { name: "review-plan", command: "/review-plan" },
  { name: "finish", command: "/finish" },
  { name: "plan-todos", command: "/plan-todos" },
  { name: "decide", command: "/decide" },
  { name: "tools", command: "/tools" },
  { name: "tools-all", command: "/tools-all" },
  { name: "tools-none", command: "/tools-none" },
  { name: "actions", command: "/actions" },
  { name: "permission", command: "/permission <level>" },
  { name: "write", command: "/write <allow|block|plan-only>" },
  { name: "full-access", command: "/full-access" },
  { name: "yolo", command: "/yolo" },
  { name: "thinking", command: "/thinking <level>" },
  { name: "status", command: "/status" },
  { name: "home", command: "/home" },
  { name: "scroll", command: "/scroll" },
  { name: "model", command: "/model", native: true },
] as const;

interface GitInfo {
  branch: string;
  dirty: number;
}

/** Anzahl geänderter Dateien aus `git status --porcelain`-Output zählen. */
export function countDirtyFiles(porcelainOutput: string): number {
  return porcelainOutput.split("\n").filter((line) => line.trim().length > 0)
    .length;
}

function getGitInfo(cwd: string): GitInfo | undefined {
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    const porcelain = execSync("git status --porcelain", {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
    }).toString();
    return { branch, dirty: countDirtyFiles(porcelain) };
  } catch {
    return undefined;
  }
}

/** Deterministischer, nächster sinnvoller Schritt anhand der Plan-Phase. */
export function nextStepFor(phase: WorkflowPhase, planExists: boolean): string {
  switch (phase) {
    case "idle":
      return planExists ? "/work" : "/plan";
    case "draft":
      return "/work";
    case "deciding":
      return "Klärung läuft — Decision Brief";
    case "reviewing":
      return "Review läuft — bitte warten";
    case "reviewed":
      return "/work";
    case "executing":
      return "/plan-todos";
    case "ready":
      return "/finish";
  }
}

interface CachedPlanState {
  phase: WorkflowPhase;
  planExists: boolean;
  completedTodos: number;
  totalTodos: number;
}

export default function uxStatusExtension(pi: ExtensionAPI): void {
  let plan: CachedPlanState = {
    phase: "idle",
    planExists: false,
    completedTodos: 0,
    totalTodos: 0,
  };
  let workflowMode: WorkflowMode = "work";
  let permissionLevel: PermissionLevel = "read-write";

  pi.events.on(WORKFLOW_STATUS_EVENT, (event: WorkflowStatusEvent) => {
    if (event.source === "plan") {
      workflowMode = event.mode;
      plan = {
        phase: event.phase,
        planExists: event.planExists,
        completedTodos: event.completedTodos,
        totalTodos: event.totalTodos,
      };
    } else if (event.source === "permission") {
      permissionLevel = event.permissionLevel;
    }
  });

  async function showStatus(ctx: ExtensionContext): Promise<void> {
    const modeLabel = workflowMode.replaceAll("_", " ").toUpperCase();
    const git = getGitInfo(ctx.cwd);
    const gitLine = git
      ? `${git.branch}${git.dirty > 0 ? `, dirty ${git.dirty}` : ""}`
      : "kein Git-Repo";
    const todosLine =
      plan.totalTodos > 0
        ? `${plan.completedTodos}/${plan.totalTodos} erledigt`
        : "keine";

    const cost = ctx.model?.cost;
    const isFreeModel =
      cost !== undefined ? cost.input === 0 && cost.output === 0 : undefined;

    const text = [
      `Mode: ${modeLabel}`,
      `Model: ${ctx.model?.id ?? "kein Modell aktiv"}`,
      `Provider: ${ctx.model?.provider ?? "-"}`,
      ...(isFreeModel !== undefined
        ? [`Kosten: ${isFreeModel ? "kostenlos" : "kostenpflichtig"}`]
        : []),
      `Thinking: ${pi.getThinkingLevel()}`,
      `Plan: ${plan.planExists ? "vorhanden" : "nicht vorhanden"}`,
      `Todos: ${todosLine}`,
      `Git: ${gitLine}`,
      `Permission: ${PERMISSION_LEVEL_LABEL[permissionLevel]}`,
      `Workflow: ${WORKFLOW_MODE_LABEL[plan.phase]}`,
      `Next: ${nextStepFor(plan.phase, plan.planExists)}`,
    ].join("\n");

    ctx.ui.notify(text, "info");
  }

  pi.registerCommand("status", {
    description: "Kompakten Workflow-Status anzeigen",
    handler: async (_args, ctx) => showStatus(ctx),
  });

  pi.registerCommand("home", {
    description: "Alias für /status",
    handler: async (_args, ctx) => showStatus(ctx),
  });

  pi.events.on(STATUS_REQUEST_EVENT, (request: StatusRequest) => {
    void showStatus(request.ctx);
  });

  pi.registerCommand("thinking", {
    description: "Thinking-Level setzen: minimal | low | medium | high | xhigh",
    handler: async (args, ctx) => {
      const level = args.trim().toLowerCase();
      const match = THINKING_LEVELS.find((candidate) => candidate === level);
      if (!match) {
        ctx.ui.notify(
          "Nutzung: /thinking minimal|low|medium|high|xhigh",
          "info",
        );
        return;
      }
      pi.setThinkingLevel(match);
      ctx.ui.notify(`Thinking-Level: ${match}.`, "info");
    },
  });

  pi.registerShortcut("ctrl+shift+t", {
    description: "Thinking wählen",
    handler: async (ctx) => {
      const selected = await runMenu(
        ctx,
        "Thinking",
        buildThinkingMenu(pi.getThinkingLevel()),
        {
          fallbackPrompt: "Thinking-Level wählen",
          nonInteractiveHint: "Nutze /thinking <level>.",
        },
      );
      if (!selected) return;
      pi.setThinkingLevel(selected);
      ctx.ui.notify(`Thinking-Level: ${selected}.`, "info");
    },
  });

  pi.registerShortcut("ctrl+shift+h", {
    description: "Shortcut-/Command-Hilfe anzeigen",
    handler: async (ctx) => {
      const registered = new Set(pi.getCommands().map((c) => c.name));
      const commands = HELP_COMMANDS.filter(
        (c) => ("native" in c && c.native) || registered.has(c.name),
      ).map((c) => c.command);

      const text = [
        "Shortcuts:",
        "  Shift+Tab      Modus wählen",
        "  Ctrl+Shift+Y   Permissions wählen",
        "  Ctrl+Shift+T   Thinking wählen",
        "  Ctrl+Shift+X   Befehlsmenü öffnen",
        "  Ctrl+Shift+H   Hilfe anzeigen",
        "  Ctrl+Alt+P     Plan-Assistent öffnen",
        "",
        "Commands:",
        ...commands.map((c) => `  ${c}`),
      ].join("\n");

      ctx.ui.notify(text, "info");
    },
  });

  const DEFAULT_THINKING_LABEL = "Denkt nach…";
  const MAX_THINKING_EXCERPT_LENGTH = 80;
  let lastThinkingLabel = DEFAULT_THINKING_LABEL;

  function buildThinkingLabel(thinking: string): string {
    const cleaned = thinking.replace(/\s+/g, " ").trim();
    if (!cleaned) return DEFAULT_THINKING_LABEL;
    const excerpt =
      cleaned.length > MAX_THINKING_EXCERPT_LENGTH
        ? `${cleaned.slice(0, MAX_THINKING_EXCERPT_LENGTH - 1)}…`
        : cleaned;
    return `Denknotiz: ${excerpt}`;
  }

  pi.on("session_start", async (_event, ctx) => {
    lastThinkingLabel = DEFAULT_THINKING_LABEL;
    ctx.ui.setHiddenThinkingLabel(lastThinkingLabel);
  });

  pi.on("message_update", async (event, ctx) => {
    const ame = event.assistantMessageEvent;
    if (ame.type === "thinking_start") {
      lastThinkingLabel = DEFAULT_THINKING_LABEL;
      ctx.ui.setHiddenThinkingLabel(lastThinkingLabel);
      return;
    }
    if (ame.type !== "thinking_delta") return;

    const block = ame.partial.content[ame.contentIndex];
    if (!block || block.type !== "thinking") return;

    const label = buildThinkingLabel(block.thinking);
    if (label === lastThinkingLabel) return;
    lastThinkingLabel = label;
    ctx.ui.setHiddenThinkingLabel(label);
  });
}
