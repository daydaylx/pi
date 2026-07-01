/**
 * UX-Status Extension
 *
 * Bündelt drei kleine, rein informative UX-Features, die keine Plan-/Guard-
 * Logik verändern:
 *   - /status (+ /home als Alias): kompakter Überblick über Mode, Modell,
 *     Thinking-Level, Plan-/Todo-Stand, Git-Zustand und Guard-Status.
 *   - Ctrl+Shift+H: kompakte Shortcut-/Command-Hilfe, die nur tatsächlich
 *     registrierte Commands zeigt (dynamisch geprüft wie in mode-switcher.ts).
 *   - Deutsches Label für eingeklappte Thinking-Blöcke.
 *
 * Plan-Phase und Guard-Status werden nicht neu berechnet, sondern über
 * WORKFLOW_STATUS_EVENT aus git-guard.ts/bash-guard.ts/plan-mode/index.ts
 * mitgelesen (Event existierte bereits, hatte bisher aber keinen Konsumenten).
 */

import { execSync } from "node:child_process";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import {
  WORKFLOW_MODE_LABEL,
  WORKFLOW_STATUS_EVENT,
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
  { name: "tools", command: "/tools" },
  { name: "tools-all", command: "/tools-all" },
  { name: "tools-none", command: "/tools-none" },
  { name: "git-guard", command: "/git-guard" },
  { name: "bash-guard", command: "/bash-guard" },
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
  planningActive: boolean;
  planExists: boolean;
  completedTodos: number;
  totalTodos: number;
}

export default function uxStatusExtension(pi: ExtensionAPI): void {
  let plan: CachedPlanState = {
    phase: "idle",
    planningActive: false,
    planExists: false,
    completedTodos: 0,
    totalTodos: 0,
  };
  let gitGuardEnabled = true;
  let bashGuardEnabled = true;

  pi.events.on(WORKFLOW_STATUS_EVENT, (event: WorkflowStatusEvent) => {
    if (event.source === "plan") {
      plan = {
        phase: event.phase,
        planningActive: event.planningActive,
        planExists: event.planExists,
        completedTodos: event.completedTodos,
        totalTodos: event.totalTodos,
      };
    } else if (event.source === "git-guard") {
      gitGuardEnabled = event.enabled;
    } else if (event.source === "bash-guard") {
      bashGuardEnabled = event.enabled;
    }
  });

  async function showStatus(ctx: ExtensionCommandContext): Promise<void> {
    const modeLabel =
      plan.phase === "idle"
        ? "kein Workflow aktiv"
        : WORKFLOW_MODE_LABEL[plan.phase];
    const git = getGitInfo(ctx.cwd);
    const gitLine = git
      ? `${git.branch}${git.dirty > 0 ? `, dirty ${git.dirty}` : ""}`
      : "kein Git-Repo";
    const todosLine =
      plan.totalTodos > 0
        ? `${plan.completedTodos}/${plan.totalTodos} erledigt`
        : "keine";

    const text = [
      `Mode: ${modeLabel}`,
      `Model: ${ctx.model?.id ?? "kein Modell aktiv"}`,
      `Thinking: ${pi.getThinkingLevel()}`,
      `Plan: ${plan.planExists ? "vorhanden" : "nicht vorhanden"}`,
      `Todos: ${todosLine}`,
      `Git: ${gitLine}`,
      `Guards: git ${gitGuardEnabled ? "on" : "off"} | bash ${bashGuardEnabled ? "on" : "off"}`,
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

  pi.registerShortcut("ctrl+shift+h", {
    description: "Shortcut-/Command-Hilfe anzeigen",
    handler: async (ctx) => {
      const registered = new Set(pi.getCommands().map((c) => c.name));
      const commands = HELP_COMMANDS.filter(
        (c) => ("native" in c && c.native) || registered.has(c.name),
      ).map((c) => c.command);

      const text = [
        "Shortcuts:",
        "  Shift+Tab      Mode-Switcher öffnen",
        "  Ctrl+Alt+P     Plan-Modus umschalten",
        "  Ctrl+Shift+H   Diese Hilfe anzeigen",
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
