/*
 * Legacy startup banner placeholder.
 *
 * The previous large ASCII banner was intentionally retired because the
 * workflow chrome now has one compact header and one compact footer in
 * ux-status.ts. Keeping this extension small prevents a second header system
 * if someone enables it manually again.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const ENABLE_STARTUP_HEADER = false;

export default function startupBannerExtension(pi: ExtensionAPI): void {
  if (!ENABLE_STARTUP_HEADER) return;

  pi.on("session_start", async (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    ctx.ui.setHeader((_tui, theme) => ({
      render(width: number): string[] {
        const text = "PI AGENT";
        return [theme.fg("accent", text.slice(0, Math.max(0, width)))];
      },
      invalidate() {},
    }));
  });
}
