/**
 * One small, truthful activity line above the editor.
 *
 * This extension deliberately never reads assistant thinking content. It only
 * reacts to lifecycle event types, so the UI can describe coarse state without
 * exposing a chain of thought or inventing work that did not happen.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

const UPDATE_INTERVAL_MS = 2_000;

function canRenderActivity(ctx: ExtensionContext): boolean {
  return ctx.mode === "tui" && ctx.hasUI;
}

function mutedDot(ctx: ExtensionContext): string {
  try {
    return ctx.ui.theme.fg("muted", "●");
  } catch {
    return "●";
  }
}

export default function activityStatusExtension(pi: ExtensionAPI): void {
  const activeToolCalls = new Set<string>();
  let lastMessage: string | undefined;
  let lastUpdateAt = 0;

  function hide(ctx: ExtensionContext): void {
    if (!canRenderActivity(ctx)) return;
    ctx.ui.setWorkingVisible(false);
    lastMessage = undefined;
  }

  function show(ctx: ExtensionContext, message: string): void {
    if (!canRenderActivity(ctx)) return;
    const now = Date.now();
    if (lastMessage === message || now - lastUpdateAt < UPDATE_INTERVAL_MS) return;
    lastMessage = message;
    lastUpdateAt = now;
    ctx.ui.setWorkingMessage(message);
    ctx.ui.setWorkingVisible(true);
  }

  pi.on("session_start", (_event, ctx) => {
    activeToolCalls.clear();
    lastMessage = undefined;
    lastUpdateAt = 0;
    if (!canRenderActivity(ctx)) return;
    ctx.ui.setHiddenThinkingLabel("");
    ctx.ui.setWorkingIndicator({ frames: [mutedDot(ctx)] });
    ctx.ui.setWorkingVisible(false);
  });

  pi.on("agent_start", (_event, ctx) => {
    activeToolCalls.clear();
    show(ctx, "Analysiert die Aufgabe …");
  });

  pi.on("tool_execution_start", (event, ctx) => {
    activeToolCalls.add(event.toolCallId);
    // The compact tool timeline is the single visible trail for tool work.
    hide(ctx);
  });

  pi.on("tool_execution_end", (event, ctx) => {
    activeToolCalls.delete(event.toolCallId);
    if (activeToolCalls.size === 0) show(ctx, "Bereitet die Antwort vor …");
  });

  pi.on("message_update", (event, ctx) => {
    // Text has started to reach the user. Never inspect the message payload or
    // thinking delta itself; this keeps raw reasoning out of the activity UI.
    if (event.assistantMessageEvent.type.startsWith("text_")) hide(ctx);
  });

  pi.on("agent_end", (_event, ctx) => hide(ctx));
  pi.on("agent_settled", (_event, ctx) => hide(ctx));

  pi.on("session_shutdown", (_event, ctx) => {
    activeToolCalls.clear();
    hide(ctx);
    if (!canRenderActivity(ctx)) return;
    ctx.ui.setWorkingMessage();
    ctx.ui.setWorkingIndicator();
    ctx.ui.setHiddenThinkingLabel();
  });
}
