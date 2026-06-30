import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  matchesKey,
  truncateToWidth,
  type Component,
} from "@earendil-works/pi-tui";
import {
  WORKFLOW_MODE_LABEL,
  WORKFLOW_STATUS_EVENT,
  type WorkflowPhase,
  type WorkflowStatusEvent,
} from "./shared/workflow-status.ts";

interface GitState {
  available: boolean;
  branch: string;
  dirtyFiles: number;
}

interface CheckState {
  label: string;
  passed: boolean;
}

interface DashboardPreference {
  autoOpen?: boolean;
}

export interface DashboardState {
  phase: WorkflowPhase;
  planningActive: boolean;
  planExists: boolean;
  completedTodos: number;
  totalTodos: number;
  gitGuardEnabled: boolean;
  yolo: boolean;
  git: GitState;
  lastCheck?: CheckState;
}

const CHECK_COMMAND_PATTERN =
  /\b(?:npm|pnpm|yarn)\s+(?:run\s+)?[\w:-]*(?:test|check|lint|typecheck|validate|build)[\w:-]*\b|\b(?:vitest|jest|pytest|tsc|shellcheck)\b|\bcargo\s+(?:test|check|clippy)\b|\bgo\s+test\b|\bflutter\s+(?:test|analyze)\b/i;
const CHECK_TOOL_PATTERN =
  /^(?:lens_diagnostics|lsp_diagnostics|pilens_diagnostics|pilens_analyze|pilens_health)$/;

function initialState(): DashboardState {
  return {
    phase: "idle",
    planningActive: false,
    planExists: false,
    completedTodos: 0,
    totalTodos: 0,
    gitGuardEnabled: true,
    yolo: false,
    git: {
      available: false,
      branch: "-",
      dirtyFiles: 0,
    },
  };
}

export function applyWorkflowStatus(
  state: DashboardState,
  event: WorkflowStatusEvent,
): void {
  if (event.source === "plan") {
    state.phase = event.phase;
    state.planningActive = event.planningActive;
    state.planExists = event.planExists;
    state.completedTodos = event.completedTodos;
    state.totalTodos = event.totalTodos;
  } else if (event.source === "git-guard") {
    state.gitGuardEnabled = event.enabled;
  } else {
    state.yolo = event.yolo;
  }
}

export function parseGitStatus(output: string): GitState {
  const lines = output.split(/\r?\n/).filter(Boolean);
  const header = lines.find((line) => line.startsWith("## "));
  const dirtyFiles = lines.filter((line) => !line.startsWith("## ")).length;
  const branchText = header?.slice(3) ?? "";
  const branch =
    branchText
      .replace(/^No commits yet on /, "")
      .split("...")[0]
      .trim() || "-";

  return {
    available: Boolean(header),
    branch,
    dirtyFiles,
  };
}

export function checkLabel(
  toolName: string,
  args: Record<string, unknown>,
): string | undefined {
  if (toolName === "bash") {
    const command =
      typeof args.command === "string"
        ? args.command.replace(/\s+/g, " ").trim()
        : "";
    if (!CHECK_COMMAND_PATTERN.test(command)) return undefined;
    return command.length > 100 ? `${command.slice(0, 97)}...` : command;
  }

  return CHECK_TOOL_PATTERN.test(toolName) ? toolName : undefined;
}

export function nextWorkflowStep(state: DashboardState): string {
  if (!state.planExists) return "/plan";
  if (state.phase === "reviewing") return "Review abschließen";
  if (state.phase === "reviewed") return "/go";
  if (state.phase === "executing") return "Offene Plan-Todos bearbeiten";
  if (state.phase === "ready") return "/finish";
  return "/review-plan";
}

export function dashboardLines(
  state: DashboardState,
  model: string,
  thinking: string,
): string[] {
  const git = state.git.available
    ? `${state.git.dirtyFiles === 0 ? "clean" : `dirty (${state.git.dirtyFiles})`} on ${state.git.branch}`
    : "not a git repository";
  const plan = state.planExists
    ? `${WORKFLOW_MODE_LABEL[state.phase].toLowerCase()}`
    : "none";
  const todos =
    state.totalTodos > 0
      ? `${state.completedTodos}/${state.totalTodos} done`
      : "0 open";
  const check = state.lastCheck
    ? `${state.lastCheck.passed ? "passed" : "failed"} — ${state.lastCheck.label}`
    : "not run in this session";
  const planGuard =
    state.planningActive || state.phase === "reviewing" ? "on" : "standby";

  return [
    `Mode: ${WORKFLOW_MODE_LABEL[state.phase]}`,
    `Model: ${model}`,
    `Thinking: ${thinking}`,
    `Git: ${git}`,
    `Plan: ${plan}`,
    `Todos: ${todos}`,
    `Checks: ${check}`,
    `Protections: plan-write ${planGuard} | git-guard ${state.gitGuardEnabled ? "on" : "off"} | permissions ${state.yolo ? "YOLO" : "normal"}`,
    `Next: ${nextWorkflowStep(state)}`,
  ];
}

class HomePanel implements Component {
  constructor(
    private readonly lines: string[],
    private readonly theme: ExtensionContext["ui"]["theme"],
    private readonly close: () => void,
  ) {}

  handleInput(data: string): void {
    if (
      data === "q" ||
      matchesKey(data, "escape") ||
      matchesKey(data, "ctrl+c") ||
      matchesKey(data, "return")
    ) {
      this.close();
    }
  }

  render(width: number): string[] {
    const usableWidth = Math.max(20, width - 4);
    const border = this.theme.fg(
      "borderMuted",
      "─".repeat(Math.max(8, usableWidth)),
    );
    return [
      border,
      this.theme.bold(this.theme.fg("accent", " Pi Dashboard ")),
      "",
      ...this.lines.map((line) => truncateToWidth(`  ${line}`, usableWidth)),
      "",
      this.theme.fg("dim", "  Enter, Esc oder q schließt die Ansicht"),
      border,
    ];
  }

  invalidate(): void {}
}

export default function workflowDashboard(pi: ExtensionAPI): void {
  const state = initialState();
  const pendingChecks = new Map<string, string>();
  let autoOpen = false;

  function restorePreference(ctx: ExtensionContext): void {
    autoOpen = false;
    for (const entry of [...ctx.sessionManager.getBranch()].reverse()) {
      if (
        entry.type !== "custom" ||
        entry.customType !== "workflow-dashboard"
      ) {
        continue;
      }
      const preference = entry.data as DashboardPreference | undefined;
      if (typeof preference?.autoOpen === "boolean") {
        autoOpen = preference.autoOpen;
        break;
      }
    }
  }

  pi.events.on(WORKFLOW_STATUS_EVENT, (payload) => {
    applyWorkflowStatus(state, payload as WorkflowStatusEvent);
  });

  async function refreshGit(ctx: ExtensionContext): Promise<void> {
    try {
      const result = await pi.exec("git", ["status", "--short", "--branch"], {
        cwd: ctx.cwd,
      });
      state.git =
        result.code === 0
          ? parseGitStatus(result.stdout)
          : { available: false, branch: "-", dirtyFiles: 0 };
    } catch {
      state.git = { available: false, branch: "-", dirtyFiles: 0 };
    }
  }

  async function showHome(ctx: ExtensionContext): Promise<void> {
    await refreshGit(ctx);
    const lines = dashboardLines(
      state,
      ctx.model?.id ?? "none",
      pi.getThinkingLevel(),
    );

    if (ctx.mode !== "tui") {
      ctx.ui.notify(lines.join("\n"), "info");
      return;
    }

    await ctx.ui.custom<void>(
      (_tui, theme, _keybindings, done) =>
        new HomePanel(lines, theme, () => done(undefined)),
      {
        overlay: true,
        overlayOptions: {
          anchor: "center",
          width: "74%",
          maxHeight: "80%",
          margin: 2,
        },
      },
    );
  }

  pi.registerCommand("home", {
    description: "Aktuellen Pi-Workflow-Status anzeigen",
    handler: async (_args, ctx) => showHome(ctx),
  });

  pi.registerCommand("dashboard", {
    description: "Automatischen Dashboard-Start für diese Session umschalten",
    handler: async (args, ctx) => {
      const requested = args.trim().toLowerCase();
      if (requested === "show") {
        await showHome(ctx);
        return;
      }
      if (requested === "on") {
        autoOpen = true;
      } else if (requested === "off") {
        autoOpen = false;
      } else if (requested === "" || requested === "toggle") {
        autoOpen = !autoOpen;
      } else {
        ctx.ui.notify("Nutzung: /dashboard [on|off|toggle|show]", "warning");
        return;
      }

      pi.appendEntry<DashboardPreference>("workflow-dashboard", {
        autoOpen,
      });
      ctx.ui.notify(
        `Dashboard-Autostart für diese Session ${autoOpen ? "aktiviert" : "deaktiviert"}.`,
        "info",
      );
    },
  });

  pi.on("tool_execution_start", async (event) => {
    const label = checkLabel(
      event.toolName,
      (event.args ?? {}) as Record<string, unknown>,
    );
    if (label) pendingChecks.set(event.toolCallId, label);
  });

  pi.on("tool_execution_end", async (event) => {
    const label = pendingChecks.get(event.toolCallId);
    if (!label) return;
    pendingChecks.delete(event.toolCallId);
    state.lastCheck = {
      label,
      passed: !event.isError,
    };
  });

  pi.on("session_start", async (_event, ctx) => {
    restorePreference(ctx);
    if (autoOpen) await showHome(ctx);
  });

  pi.on("session_tree", async (_event, ctx) => {
    restorePreference(ctx);
    await refreshGit(ctx);
  });
}
