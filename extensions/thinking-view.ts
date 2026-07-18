/**
 * Compact, truthful thinking-state line in the footer status bar.
 *
 * This extension never renders thinking content itself — Pi's built-in
 * AssistantMessageComponent already streams real thinking blocks in the
 * chat transcript (toggle: Ctrl+T / app.thinking.toggle). This extension
 * only tracks lifecycle events to show a one-line state (WAITING,
 * THINKING, ANSWERING, TOOL RUNNING, ...) in the footer via
 * ctx.ui.setStatus(), and keeps the hidden-thinking label
 * (ctx.ui.setHiddenThinkingLabel()) informative while blocks are collapsed.
 *
 * Deliberately does not register setWidget/setFooter/setHeader/setEditor
 * (reserved for pi-zentui/pi-tool-display, see AGENTS.md) and never uses a
 * repeating timer — a single re-armed setTimeout tracks inactivity instead.
 */

import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  loadThinkingViewConfig,
  saveThinkingViewConfig,
  type ThinkingViewConfig,
  type ThinkingViewMode,
} from "./thinking-view-config.ts";
import { CONTROL_CENTER_EVENTS, type OpenControlCenterMenuEvent } from "./shared/control-center-events.ts";
import { runMenu, type MenuEntry } from "./shared/menu-ui.ts";

const STATUS_KEY = "thinking-view";
const RENDER_THROTTLE_FLOOR_MS = 50;
const MAX_STATUS_LENGTH = 120;

type Phase =
  | "waiting"
  | "thinking"
  | "answering"
  | "preparing_tool"
  | "tool_running"
  | "finished"
  | "no_visible_thinking"
  | "error";

interface TurnState {
  phase: Phase;
  sawThinking: boolean;
  thinkingCharCount: number;
  thinkingStartedAt: number | undefined;
  activeToolCalls: Map<string, string>;
  lastToolLabel: string | undefined;
}

function freshTurnState(): TurnState {
  return {
    phase: "waiting",
    sawThinking: false,
    thinkingCharCount: 0,
    thinkingStartedAt: undefined,
    activeToolCalls: new Map(),
    lastToolLabel: undefined,
  };
}

function canRender(ctx: ExtensionContext): boolean {
  return ctx.mode === "tui" && ctx.hasUI;
}

function stripAnsi(text: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional ANSI strip
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

function formatElapsed(startedAt: number | undefined, now: number): string {
  if (!startedAt) return "00:00";
  const totalSeconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function truncateStatus(text: string): string {
  const clean = stripAnsi(text).replace(/\s+/g, " ").trim();
  if (clean.length <= MAX_STATUS_LENGTH) return clean;
  return `${clean.slice(0, MAX_STATUS_LENGTH - 1)}…`;
}

export default function thinkingViewExtension(pi: ExtensionAPI): void {
  let config: ThinkingViewConfig = loadThinkingViewConfig();
  let enabled = config.mode !== "off";
  let mode: ThinkingViewMode = config.mode === "off" ? "compact" : config.mode;

  let turn = freshTurnState();
  let currentModelName: string | undefined;
  let currentThinkingLevel: string | undefined;
  let lastEventAt = 0;
  let lastRenderedText: string | undefined;
  let lastRenderAt = 0;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;

  function clearIdleTimer(): void {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = undefined;
    }
  }

  function armIdleTimer(ctx: ExtensionContext): void {
    clearIdleTimer();
    if (!enabled || !canRender(ctx)) return;
    if (turn.phase === "finished") return;
    const warnAfterMs = Math.max(1, config.inactivityWarningSeconds) * 1000;
    idleTimer = setTimeout(() => {
      render(ctx, true);
    }, warnAfterMs);
  }

  function phaseLabel(phase: Phase): { icon: string; text: string } {
    switch (phase) {
      case "waiting":
        return { icon: "◌", text: "WARTEN" };
      case "thinking":
        return { icon: "◉", text: "DENKEN" };
      case "answering":
        return { icon: "●", text: "ANTWORTEN" };
      case "preparing_tool":
        return { icon: "●", text: "Werkzeug vorbereiten" };
      case "tool_running":
        return { icon: "●", text: "Werkzeug läuft" };
      case "finished":
        return { icon: "✓", text: "FERTIG" };
      case "no_visible_thinking":
        return { icon: "○", text: "Kein sichtbares Denken" };
      case "error":
        return { icon: "!", text: "FEHLER" };
    }
  }

  function buildStatusText(now: number): string | undefined {
    if (!enabled) return undefined;

    if (
      turn.lastToolLabel &&
      (turn.phase === "tool_running" || turn.phase === "preparing_tool")
    ) {
      return truncateStatus(turn.lastToolLabel);
    }

    const { icon, text } = phaseLabel(turn.phase);
    const parts: string[] = [`${icon} ${text}`];

    if (turn.phase === "thinking") {
      if (config.showElapsedTime) {
        parts.push(formatElapsed(turn.thinkingStartedAt, now));
      }
      if (mode === "focus" && config.showCharCount) {
        parts.push(`${turn.thinkingCharCount} Zeichen`);
      }
      if (
        mode === "focus" &&
        config.showThinkingLevel &&
        currentThinkingLevel
      ) {
        parts.push(currentThinkingLevel);
      }
      if (mode === "focus" && config.showModel && currentModelName) {
        parts.push(currentModelName);
      }
    }

    const idleMs = now - lastEventAt;
    const warnAfterMs = Math.max(1, config.inactivityWarningSeconds) * 1000;
    if (lastEventAt > 0 && idleMs >= warnAfterMs && turn.phase !== "finished") {
      const idleSeconds = Math.floor(idleMs / 1000);
      return truncateStatus(`! ${text} · keine Aktivität seit ${idleSeconds}s`);
    }

    return truncateStatus(parts.join(" · "));
  }

  function render(ctx: ExtensionContext, force = false): void {
    if (!canRender(ctx)) return;
    const now = Date.now();
    const throttle = Math.max(
      RENDER_THROTTLE_FLOOR_MS,
      config.renderThrottleMs,
    );
    if (!force && now - lastRenderAt < throttle) return;

    const text = buildStatusText(now);
    if (text === lastRenderedText) {
      lastRenderAt = now;
      return;
    }
    lastRenderedText = text;
    lastRenderAt = now;
    ctx.ui.setStatus(STATUS_KEY, text);
  }

  function updateHiddenLabel(ctx: ExtensionContext): void {
    if (!canRender(ctx)) return;
    if (!enabled) {
      ctx.ui.setHiddenThinkingLabel();
      return;
    }
    const now = Date.now();
    const bits: string[] = ["Denken"];
    if (config.showModel && currentModelName) bits.push(currentModelName);
    if (config.showThinkingLevel && currentThinkingLevel)
      bits.push(currentThinkingLevel);
    if (config.showElapsedTime && turn.thinkingStartedAt) {
      bits.push(formatElapsed(turn.thinkingStartedAt, now));
    }
    ctx.ui.setHiddenThinkingLabel(`${bits.join(" · ")}…`);
  }

  function noteActivity(ctx: ExtensionContext): void {
    lastEventAt = Date.now();
    armIdleTimer(ctx);
  }

  function resetTurn(): void {
    turn = freshTurnState();
  }

  function hideStatus(ctx: ExtensionContext): void {
    clearIdleTimer();
    if (!canRender(ctx)) return;
    if (lastRenderedText !== undefined) {
      lastRenderedText = undefined;
      ctx.ui.setStatus(STATUS_KEY, undefined);
    }
  }

  pi.on("session_start", (_event, ctx) => {
    resetTurn();
    lastEventAt = 0;
    lastRenderedText = undefined;
    currentModelName = ctx.model?.name ?? ctx.model?.id;
    currentThinkingLevel = undefined;
    hideStatus(ctx);
    updateHiddenLabel(ctx);
  });

  pi.on("model_select", (event, ctx) => {
    currentModelName = event.model.name ?? event.model.id;
    updateHiddenLabel(ctx);
  });

  pi.on("thinking_level_select", (event, ctx) => {
    currentThinkingLevel = event.level === "off" ? undefined : event.level;
    updateHiddenLabel(ctx);
  });

  pi.on("agent_start", (_event, ctx) => {
    resetTurn();
    noteActivity(ctx);
    render(ctx, true);
  });

  pi.on("message_update", (event, ctx) => {
    const ame = event.assistantMessageEvent;
    const previousPhase = turn.phase;
    switch (ame.type) {
      case "thinking_start":
        turn.phase = "thinking";
        turn.sawThinking = true;
        turn.thinkingStartedAt = turn.thinkingStartedAt ?? Date.now();
        break;
      case "thinking_delta":
        turn.phase = "thinking";
        turn.thinkingCharCount += ame.delta.length;
        break;
      case "thinking_end":
        break;
      case "text_start":
      case "text_delta":
        turn.phase = "answering";
        break;
      case "toolcall_start":
      case "toolcall_delta":
        turn.phase = "preparing_tool";
        break;
      case "error":
        turn.phase = "error";
        break;
      default:
        break;
    }
    noteActivity(ctx);
    updateHiddenLabel(ctx);
    render(ctx, turn.phase !== previousPhase);
  });

  pi.on("tool_execution_start", (event, ctx) => {
    turn.phase = "tool_running";
    turn.activeToolCalls.set(event.toolCallId, event.toolName);
    turn.lastToolLabel = `${event.toolName.toUpperCase()} · ${describeToolArgs(event.args)}`;
    noteActivity(ctx);
    render(ctx, true);
  });

  pi.on("tool_execution_end", (event, ctx) => {
    turn.activeToolCalls.delete(event.toolCallId);
    if (turn.activeToolCalls.size === 0) {
      turn.lastToolLabel = undefined;
      turn.phase = "answering";
    }
    noteActivity(ctx);
    render(ctx, true);
  });

  pi.on("message_end", (event, ctx) => {
    if (event.message.role !== "assistant") return;
    if (!turn.sawThinking && turn.phase !== "error") {
      turn.phase = "no_visible_thinking";
      render(ctx, true);
    }
    noteActivity(ctx);
  });

  pi.on("agent_end", (_event, ctx) => {
    noteActivity(ctx);
  });

  pi.on("agent_settled", (_event, ctx) => {
    turn.phase = "finished";
    clearIdleTimer();
    render(ctx, true);
    updateHiddenLabel(ctx);
    hideStatus(ctx);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    clearIdleTimer();
    resetTurn();
    hideStatus(ctx);
    if (!canRender(ctx)) return;
    ctx.ui.setHiddenThinkingLabel();
  });

  function applyMode(
    next: ThinkingViewMode,
    ctx: ExtensionCommandContext,
  ): void {
    mode = next === "off" ? mode : next;
    enabled = next !== "off";
    config = { ...config, mode: next };
    saveThinkingViewConfig(config);
    if (!enabled) {
      hideStatus(ctx);
      ctx.ui.setHiddenThinkingLabel();
    } else {
      render(ctx, true);
      updateHiddenLabel(ctx);
    }
  }

  pi.registerCommand("thinking-view", {
    description:
      "Thinking-Statuszeile steuern: compact | focus | off | status | clear",
    handler: async (args, ctx) => {
      const sub = args.trim().toLowerCase();
      switch (sub) {
        case "compact":
        case "focus":
        case "off":
          applyMode(sub, ctx);
          ctx.ui.notify(`thinking-view: ${sub}`, "info");
          return;
        case "status": {
          const { text } = phaseLabel(turn.phase);
          const idleSeconds =
            lastEventAt > 0 ? Math.floor((Date.now() - lastEventAt) / 1000) : 0;
          ctx.ui.notify(
            `${text} · ${turn.thinkingCharCount} Zeichen · letzte Aktivität vor ${idleSeconds}s · Modus: ${enabled ? mode : "off"}`,
            "info",
          );
          return;
        }
        case "clear":
          resetTurn();
          hideStatus(ctx);
          ctx.ui.notify("thinking-view: Zustand zurückgesetzt", "info");
          return;
        default:
          ctx.ui.notify(
            "Nutzung: /thinking-view compact|focus|off|status|clear",
            "warning",
          );
      }
    },
  });

  pi.events.on(CONTROL_CENTER_EVENTS.openThinkingView, async (event) => {
    const ctx = (event as OpenControlCenterMenuEvent).ctx;
    const selected = await runMenu(ctx, "Thinking-Anzeige", [
      { id: "thinking-view-compact", label: "Kompakt", description: "Kurze Thinking-Statuszeile", value: "compact" as const, current: enabled && mode === "compact" },
      { id: "thinking-view-focus", label: "Fokus", description: "Statuszeile mit zusätzlichen Details", value: "focus" as const, current: enabled && mode === "focus" },
      { id: "thinking-view-off", label: "Aus", description: "Thinking-Statuszeile ausblenden", value: "off" as const, current: !enabled },
    ] satisfies MenuEntry<ThinkingViewMode>[], { fallbackPrompt: "Thinking-Anzeige wählen" });
    if (!selected) return;
    applyMode(selected, ctx as ExtensionCommandContext);
    ctx.ui.notify(`Thinking-Anzeige: ${selected}.`, "info");
  });
}

function describeToolArgs(args: unknown): string {
  if (args && typeof args === "object") {
    const record = args as Record<string, unknown>;
    for (const key of ["path", "file_path", "command", "pattern", "query"]) {
      const value = record[key];
      if (typeof value === "string" && value.length > 0) return value;
    }
  }
  return "…";
}
