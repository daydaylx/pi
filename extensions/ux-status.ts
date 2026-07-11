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
import { loadUiConfig } from "./shared/ui-config.ts";
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
  buildFooterSegments,
  fitFooterSegments,
  formatEmptyPlanState,
  formatFooterLine,
  formatModePhase,
  formatPermissionWarning,
  toneColor,
  type FooterSegmentTone,
  type VisualWorkflowState,
} from "./shared/visual-system.ts";

// Feste Pi-Commands, die NICHT über pi.getCommands() auffindbar sind, aber
// garantiert existieren und in der Hilfe auftauchen sollen.
const NATIVE_HELP_COMMANDS = ["  /model — Modell wählen (nativ)"];
const CENTRAL_STATUS_KEY = "workflow-summary";

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

function notifyBox(ctx: ExtensionContext, options: NotifyBoxOptions): void {
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

// #60: grobe Zustände statt Rohtext-Ausschnitten der Denknotiz. Bewusst kein
// Content-Parsing des Thinking-Texts (modellabhängig/fragil) — die Phasen
// "analyzing"/"planning" werden rein über die seit thinking_start verstrichene
// Zeit geschätzt.
export type ThinkingUiState =
  | "idle"
  | "thinking"
  | "analyzing"
  | "inspecting"
  | "planning"
  | "preparing-response";

export const THINKING_STATE_LABEL: Record<ThinkingUiState, string> = {
  idle: "",
  thinking: "Denkt nach…",
  analyzing: "Analysiert die Aufgabe…",
  inspecting: "Prüft relevante Dateien…",
  planning: "Vergleicht mögliche Lösungen…",
  "preparing-response": "Bereitet die Antwort vor…",
};

const THINKING_ANALYZING_AFTER_MS = 5_000;
const THINKING_PLANNING_AFTER_MS = 15_000;

/** Grober Zeitfortschritt innerhalb eines laufenden Thinking-Blocks. */
export function timeBasedThinkingState(elapsedMs: number): ThinkingUiState {
  if (elapsedMs >= THINKING_PLANNING_AFTER_MS) return "planning";
  if (elapsedMs >= THINKING_ANALYZING_AFTER_MS) return "analyzing";
  return "thinking";
}

const THINKING_UPDATE_WINDOW_MS = 1_800;

/** Höchstens ein sichtbares Update pro Zeitfenster, außer bei `immediate`. */
export function shouldRenderThinkingUpdate(
  now: number,
  lastRenderedAt: number,
  immediate: boolean,
): boolean {
  return immediate || now - lastRenderedAt >= THINKING_UPDATE_WINDOW_MS;
}

export interface ThinkingDebugCounters {
  received: number;
  rendered: number;
  suppressed: number;
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
  let footerTui: { requestRender(): void } | undefined;
  let footerInstalled = false;
  let footerMode = loadUiConfig().footer;

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
      activeSubagents: subagents.filter(
        (entry) =>
          entry.status === "running" ||
          entry.status === "queued" ||
          entry.status === "waiting",
      ).length,
      subagentWarnings: subagents.reduce(
        (sum, entry) => sum + (entry.warnings ?? 0),
        0,
      ),
      subagentErrors: subagents.reduce(
        (sum, entry) =>
          sum +
          (entry.errors ??
            (entry.status === "failed" || entry.status === "blocked" ? 1 : 0)),
        0,
      ),
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
      footerInstalled = true;
      ui.setFooter((tui: any, theme: any, footerData: any) => {
        footerTui = tui;
        const dispose = footerData?.onBranchChange?.(() => tui.requestRender());
        return {
          render(width: number): string[] {
            const state = buildVisualState(ctx);
            const segments = fitFooterSegments(
              buildFooterSegments(
                state,
                footerData?.getGitBranch?.(),
                footerMode === "priority" && width < 96,
              ),
              width,
            );
            const separator = theme.fg("dim", " · ");
            return [
              segments
                .map((segment) => {
                  const color = footerToneColor(segment.tone);
                  return theme.fg(color, segment.text);
                })
                .join(separator),
            ];
          },
          invalidate() {},
          dispose,
        };
      });
    }
  }

  function footerToneColor(
    tone: FooterSegmentTone,
  ): "text" | "accent" | "warning" | "error" | "success" | "muted" {
    if (tone === "muted") return "muted";
    const color = toneColor(tone);
    return color === "text" ? "muted" : color;
  }

  function updateCentralStatus(ctx: ExtensionContext): void {
    if (footerInstalled) {
      ctx.ui.setStatus(CENTRAL_STATUS_KEY, undefined);
      footerTui?.requestRender();
      return;
    }
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
      `Modell: ${ctx.model?.id ?? "kein Modell aktiv"}`,
      `Anbieter: ${ctx.model?.provider ?? "-"}`,
      ...(isFreeModel !== undefined
        ? [`Kosten: ${isFreeModel ? "kostenlos" : "kostenpflichtig"}`]
        : []),
      `Denken: ${pi.getThinkingLevel()}`,
      ...(plan.planExists ? [`Plan: vorhanden`, `Todos: ${todosLine}`] : []),
      `Git: ${gitLine}`,
      `Berechtigung: ${PERMISSION_LEVEL_LABEL[permissionLevel]}`,
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
        "Denken",
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
        (shortcut) => `${shortcut.label.padEnd(14)} ${shortcut.description}`,
      );
      const commandLines = [...commands, ...NATIVE_HELP_COMMANDS];
      const text = [
        "Tastenkürzel:",
        ...shortcutLines.map((line) => `  ${line}`),
        "",
        "Befehle:",
        ...commandLines,
      ].join("\n");

      notifyBox(ctx, {
        title: "Hilfe",
        sections: [
          { title: "Tastenkürzel", lines: shortcutLines },
          { title: "Befehle", lines: commandLines },
        ],
        plainText: text,
        level: "info",
      });
    },
  });

  // #60: grobe, zeitbasierte Zustände statt Rohtext-Ausschnitten des
  // kumulativen Thinking-Blocks — vermeidet die vorherige Flut fast
  // identischer Denknotizen bei dicht aufeinanderfolgenden thinking_delta.
  let thinkingState: ThinkingUiState = "idle";
  let thinkingStartedAt = 0;
  let thinkingLastRenderedAt = 0;
  let thinkingDebug = false;
  let thinkingCounters: ThinkingDebugCounters = {
    received: 0,
    rendered: 0,
    suppressed: 0,
  };

  function renderThinkingState(
    ctx: ExtensionContext,
    next: ThinkingUiState,
    now: number,
    immediate: boolean,
  ): void {
    if (next === thinkingState && !immediate) return;
    if (!shouldRenderThinkingUpdate(now, thinkingLastRenderedAt, immediate)) {
      if (thinkingDebug) thinkingCounters.suppressed++;
      return;
    }
    thinkingState = next;
    thinkingLastRenderedAt = now;
    if (thinkingDebug) thinkingCounters.rendered++;
    ctx.ui.setHiddenThinkingLabel(
      next === "idle" ? undefined : THINKING_STATE_LABEL[next],
    );
  }

  function resetThinkingState(ctx: ExtensionContext): void {
    renderThinkingState(ctx, "idle", Date.now(), true);
  }

  pi.on("session_start", async (_event, ctx) => {
    activeCtx = ctx;
    footerMode = loadUiConfig().footer;
    installCentralChrome(ctx);
    updateCentralStatus(ctx);
    resetThinkingState(ctx);
  });

  pi.on("session_shutdown", async () => {
    activeCtx = undefined;
    footerTui = undefined;
    footerInstalled = false;
  });

  pi.on("message_update", async (event, ctx) => {
    const ame = event.assistantMessageEvent;
    const now = Date.now();
    if (ame.type === "thinking_start") {
      thinkingStartedAt = now;
      renderThinkingState(ctx, "thinking", now, true);
      return;
    }
    if (ame.type === "thinking_delta") {
      if (thinkingDebug) thinkingCounters.received++;
      if (thinkingState === "idle") return;
      renderThinkingState(
        ctx,
        timeBasedThinkingState(now - thinkingStartedAt),
        now,
        false,
      );
      return;
    }
    if (ame.type === "toolcall_start") {
      if (thinkingState === "idle") return;
      renderThinkingState(ctx, "inspecting", now, false);
      return;
    }
    if (ame.type === "thinking_end") {
      renderThinkingState(ctx, "preparing-response", now, true);
      return;
    }
    if (ame.type === "error") {
      resetThinkingState(ctx);
      return;
    }
  });

  pi.on("message_end", async (_event, ctx) => {
    resetThinkingState(ctx);
  });

  pi.registerCommand("thinking-debug", {
    description:
      "Thinking-Anzeige-Debug: on | off | zeigt Zähler (received/rendered/suppressed)",
    handler: async (args, ctx) => {
      const sub = args.trim().toLowerCase();
      if (sub === "on") {
        thinkingDebug = true;
        thinkingCounters = { received: 0, rendered: 0, suppressed: 0 };
        ctx.ui.notify("Thinking-Debug an.", "info");
        return;
      }
      if (sub === "off") {
        thinkingDebug = false;
        ctx.ui.notify("Thinking-Debug aus.", "info");
        return;
      }
      if (!thinkingDebug) {
        ctx.ui.notify(
          "Thinking-Debug ist aus. Nutze: /thinking-debug on|off",
          "warning",
        );
        return;
      }
      ctx.ui.notify(
        `Thinking-Debug: received=${thinkingCounters.received} rendered=${thinkingCounters.rendered} suppressed=${thinkingCounters.suppressed}`,
        "info",
      );
    },
  });
}
