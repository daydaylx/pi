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
import {
  renderInfoBoxString,
  type InfoBoxBackground,
  type InfoBoxTone,
} from "./shared/info-box.ts";
import { glyphsFor, resolveRenderProfile } from "./shared/render-profile.ts";
import { runMenu } from "./shared/menu-ui.ts";
import { SHORTCUTS } from "./shared/shortcuts.ts";
import { buildThinkingMenu, THINKING_LEVELS } from "./shared/thinking-menu.ts";
import {
  PERMISSION_LEVEL_LABEL,
  STATUS_REQUEST_EVENT,
  WORKFLOW_MODE_LABEL,
  WORKFLOW_PHASE_LABEL,
  WORKFLOW_STATUS_EVENT,
  type PermissionLevel,
  type StatusRequest,
  type WorkflowMode,
  type WorkflowPhase,
  type WorkflowStatusEvent,
} from "./shared/workflow-status.ts";
import { getWidgetState } from "./subagents/widget.ts";
import {
  formatEmptyPlanState,
  formatFooterLine,
  formatFooterLineCompact,
  formatModePhase,
  formatPermissionWarning,
  permissionTone,
  toneColor,
  type VisualWorkflowState,
} from "./shared/visual-system.ts";

// Feste Pi-Commands, die NICHT über pi.getCommands() auffindbar sind, aber
// garantiert existieren und in der Hilfe auftauchen sollen.
const NATIVE_HELP_COMMANDS = ["  /model — Modell wählen (nativ)"];
const CENTRAL_STATUS_KEY = "workflow-summary";

function truncatePlain(value: string, width: number): string {
  if (width <= 0) return "";
  if (value.length <= width) return value;
  if (width === 1) return "…";
  return `${value.slice(0, width - 1)}…`;
}

function notifyLevelToInfoBoxTone(
  level: "info" | "warning" | "error" | string,
): InfoBoxTone {
  if (level === "error") return "error";
  if (level === "warning") return "warning";
  return "accent";
}

function notifyLevelToBackground(
  level: "info" | "warning" | "error" | string,
): InfoBoxBackground {
  if (level === "error") return "toolErrorBg";
  if (level === "warning") return "toolPendingBg";
  return "customMessageBg";
}

interface NotifyBoxOptions {
  title: string;
  subtitle?: string;
  status?: { symbol: string; label: string };
  sections?: { title?: string; lines: string[] }[];
  plainText: string;
  level?: "info" | "warning" | "error";
  width?: number;
}

function notifyBox(
  ctx: ExtensionContext,
  options: NotifyBoxOptions,
): void {
  const level = options.level ?? "info";
  const theme = ctx.ui.theme as any;
  if (
    ctx.mode !== "tui" ||
    typeof theme?.fg !== "function" ||
    typeof theme?.bg !== "function" ||
    typeof theme?.bold !== "function"
  ) {
    ctx.ui.notify(options.plainText, level);
    return;
  }
  const width = Math.max(
    40,
    Math.min(100, options.width ?? process.stdout.columns ?? 80),
  );
  const boxText = renderInfoBoxString(
    {
      title: options.title,
      subtitle: options.subtitle,
      status: options.status,
      sections: options.sections,
      tone: notifyLevelToInfoBoxTone(level),
      background: notifyLevelToBackground(level),
    },
    width,
    theme,
  );
  ctx.ui.notify(boxText, level);
}

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
  let activeCtx: ExtensionContext | undefined;

  function currentThemeName(ctx: ExtensionContext): string {
    return (ctx.ui.theme as { name?: string } | undefined)?.name ?? "pi-vivid";
  }

  function buildVisualState(ctx: ExtensionContext): VisualWorkflowState {
    const subagentState = getWidgetState();
    const subagents = Array.from(subagentState.subagents.values());
    return {
      mode: workflowMode,
      phase: plan.phase,
      permissionLevel,
      planExists: plan.planExists,
      completedTodos: plan.completedTodos,
      totalTodos: plan.totalTodos,
      model: ctx.model?.id,
      thinking: pi.getThinkingLevel(),
      themeName: currentThemeName(ctx),
      activeSubagents: subagents.filter((entry) =>
        entry.status === "running" || entry.status === "queued" || entry.status === "waiting",
      ).length,
      subagentWarnings: subagents.reduce((sum, entry) => sum + (entry.warnings ?? 0), 0),
      subagentErrors: subagents.reduce((sum, entry) =>
        sum + (entry.errors ?? (entry.status === "failed" || entry.status === "blocked" ? 1 : 0)),
      0),
      nextStep: nextStepFor(plan.phase, plan.planExists),
    };
  }

  function installCentralChrome(ctx: ExtensionContext): void {
    const ui = ctx.ui as typeof ctx.ui & {
      setHeader?: (factory: unknown) => void;
      setFooter?: (factory: unknown) => void;
    };

    // Der Header-Slot gehört startup-banner.ts (großer ASCII-Banner). Diese
    // Extension setzt hier bewusst keinen eigenen Header, um den Banner nicht
    // zu überschreiben.

    if (ctx.mode === "tui" && typeof ui.setFooter === "function") {
      ui.setFooter((tui: any, theme: any, footerData: any) => {
        const dispose = footerData?.onBranchChange?.(() => tui.requestRender());
        return {
          render(width: number): string[] {
            const state = buildVisualState(ctx);
            const raw = truncatePlain(
              width < 96
                ? formatFooterLineCompact(ctx.cwd, state, footerData?.getGitBranch?.())
                : formatFooterLine(ctx.cwd, state, footerData?.getGitBranch?.()),
              width,
            );
            const modeColor = toneColor(permissionTone(permissionLevel));
            return [theme.fg(modeColor === "text" ? "muted" : modeColor, raw)];
          },
          invalidate() {},
          dispose,
        };
      });
    }
  }

  function updateCentralStatus(ctx: ExtensionContext): void {
    const state = buildVisualState(ctx);
    const git = getGitInfo(ctx.cwd);
    const summary = formatFooterLine(ctx.cwd, state, git?.branch);
    ctx.ui.setStatus(CENTRAL_STATUS_KEY, summary);
  }

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
    if (activeCtx) updateCentralStatus(activeCtx);
  });

  async function showStatus(ctx: ExtensionContext): Promise<void> {
    const modeLabel = WORKFLOW_MODE_LABEL[workflowMode];
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

    const warning = formatPermissionWarning(permissionLevel);
    const level = warning ? "warning" : "info";

    const detailLines = [
      `Modus: ${modeLabel}`,
      `Model: ${ctx.model?.id ?? "kein Modell aktiv"}`,
      `Provider: ${ctx.model?.provider ?? "-"}`,
      ...(isFreeModel !== undefined
        ? [`Kosten: ${isFreeModel ? "kostenlos" : "kostenpflichtig"}`]
        : []),
      `Thinking: ${pi.getThinkingLevel()}`,
      ...(plan.planExists
        ? [`Plan: vorhanden`, `Todos: ${todosLine}`]
        : []),
      `Git: ${gitLine}`,
      `Permission: ${PERMISSION_LEVEL_LABEL[permissionLevel]}`,
      ...(plan.planExists
        ? [`Phase: ${WORKFLOW_PHASE_LABEL[plan.phase]}`]
        : []),
    ];

    const sections: { title?: string; lines: string[] }[] = [
      { title: "Details", lines: detailLines },
    ];

    if (plan.planExists) {
      sections.push({
        title: "Nächster Schritt",
        lines: [nextStepFor(plan.phase, true)],
      });
    } else {
      sections.push({
        title: "Nächste sinnvolle Schritte",
        lines: [
          "1. /plan     Schnell- oder Architekturplan erstellen",
          "2. /decide   Entscheidung klären",
          "3. /actions  Menü öffnen",
        ],
      });
    }

    if (warning) {
      sections.push({
        title: "Warnung",
        lines: warning.split("\n").filter((line) => line.trim().length > 0),
      });
    }

    const plainText = plan.planExists
      ? [
        "STATUS",
        formatModePhase({ mode: workflowMode, phase: plan.phase }),
        "",
        ...detailLines,
        "",
        "Nächster Schritt",
        nextStepFor(plan.phase, true),
        ...(warning ? ["", warning] : []),
      ].join("\n")
      : [
        formatEmptyPlanState(),
        "",
        ...detailLines,
        ...(warning ? ["", warning] : []),
      ].join("\n");

    notifyBox(ctx, {
      title: "STATUS",
      subtitle: plan.planExists
        ? formatModePhase({ mode: workflowMode, phase: plan.phase })
        : "KEIN AKTIVER PLAN",
      status: warning
        ? {
          symbol: glyphsFor(resolveRenderProfile({ mode: ctx.mode })).status
            .warning,
          label: PERMISSION_LEVEL_LABEL[permissionLevel],
        }
        : undefined,
      sections,
      plainText,
      level,
    });
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

  pi.on("model_select", async (_event, ctx) => updateCentralStatus(ctx));
  pi.on("thinking_level_select", async (_event, ctx) =>
    updateCentralStatus(ctx),
  );

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

  pi.registerShortcut(SHORTCUTS.thinkingMenu.keys, {
    description: SHORTCUTS.thinkingMenu.description,
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

  pi.registerShortcut(SHORTCUTS.help.keys, {
    description: SHORTCUTS.help.description,
    handler: async (ctx) => {
      // Beide Listen entstehen aus den tatsächlichen Registrierungen: Commands
      // aus pi.getCommands(), Shortcuts aus der geteilten SHORTCUTS-Konstante.
      // Eine handgepflegte Liste kann so nicht mehr driften.
      const commands = pi
        .getCommands()
        .map((command) => {
          const description = (command as { description?: string }).description;
          return `  /${command.name}${description ? ` — ${description}` : ""}`;
        })
        .sort((a, b) => a.localeCompare(b, "de"));

      const shortcutLines = Object.values(SHORTCUTS).map(
        (shortcut) =>
          `${shortcut.label.padEnd(14)} ${shortcut.description}`,
      );
      const commandLines = [...commands, ...NATIVE_HELP_COMMANDS];
      const text = [
        "Shortcuts:",
        ...shortcutLines.map((line) => `  ${line}`),
        "",
        "Commands:",
        ...commandLines,
      ].join("\n");

      notifyBox(ctx, {
        title: "Hilfe",
        sections: [
          { title: "Shortcuts", lines: shortcutLines },
          { title: "Commands", lines: commandLines },
        ],
        plainText: text,
        level: "info",
      });
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
    activeCtx = ctx;
    installCentralChrome(ctx);
    updateCentralStatus(ctx);
    lastThinkingLabel = DEFAULT_THINKING_LABEL;
    ctx.ui.setHiddenThinkingLabel(lastThinkingLabel);
  });

  pi.on("session_shutdown", async () => {
    activeCtx = undefined;
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
