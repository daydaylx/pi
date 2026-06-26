/**
 * Context Bar Extension
 *
 * Displays a visual token-usage bar in the footer status line after each turn.
 * Color transitions: green (<50%) → yellow (50–80%) → red (>80%).
 *
 * Commands:
 *   /context-bar  - Toggle on/off
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

const BAR_WIDTH = 10;
const DEFAULT_MAX_TOKENS = 200_000;

function buildBar(
  tokens: number,
  maxTokens: number,
  ctx: ExtensionContext,
): string {
  const pct = Math.min(tokens / maxTokens, 1);
  const filled = Math.round(pct * BAR_WIDTH);
  const bar = "▓".repeat(filled) + "░".repeat(BAR_WIDTH - filled);
  const label = `${Math.round(tokens / 1000)}K`;

  const color = pct >= 0.8 ? "error" : pct >= 0.5 ? "warning" : "success";

  return ctx.ui.theme.fg(color, `${bar} ${label}`);
}

export default function contextBarExtension(pi: ExtensionAPI): void {
  let enabled = true;

  function refresh(ctx: ExtensionContext): void {
    if (!enabled) {
      ctx.ui.setStatus("context-bar", undefined);
      return;
    }

    const usage = ctx.getContextUsage();
    if (!usage) {
      ctx.ui.setStatus("context-bar", undefined);
      return;
    }

    const tokens = usage.tokens ?? 0;
    const maxTokens =
      (usage as { maxTokens?: number }).maxTokens ?? DEFAULT_MAX_TOKENS;
    ctx.ui.setStatus("context-bar", buildBar(tokens, maxTokens, ctx));
  }

  pi.registerCommand("context-bar", {
    description: "Token-Usage-Balken in der Statuszeile ein-/ausschalten",
    handler: async (_args, ctx) => {
      enabled = !enabled;
      refresh(ctx);
      ctx.ui.notify(
        enabled ? "Context-Bar aktiviert" : "Context-Bar deaktiviert",
        "info",
      );
    },
  });

  pi.on("turn_end", async (_event, ctx) => {
    refresh(ctx);
  });

  pi.on("session_start", async (_event, ctx) => {
    refresh(ctx);
  });
}
