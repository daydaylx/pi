/**
 * Startup-Banner Extension
 *
 * Zeigt beim Session-Start einen großen, farbigen PI-AGENT-Blockbanner als
 * persistenten Header oberhalb des Chats (ctx.ui.setHeader) — nicht als
 * flüchtige notify()-Statuszeile. Skaliert nach Terminalbreite:
 *   - breit:   "PI AGENT" als Blockglyphen mit Farbverlauf + "by Grunert"
 *              dezent darunter + Kurzhinweise
 *   - schmal:  "PI" als Blockglyphen + "by Grunert" + kürzerer Hinweis
 *   - winzig:  eine einfache Textzeile
 * Respektiert NO_COLOR und die vom Theme erkannte Terminal-Farbfähigkeit.
 *
 * Deaktivieren: aus settings.json entfernen oder ENABLE_STARTUP_BANNER auf
 * false setzen.
 */

import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import {
  buildBigBanner,
  buildPlainBannerLine,
  resolveBannerColorMode,
  resolveBannerTier,
} from "./shared/banner-render.ts";
import { truncateModelName } from "./shared/render-profile.ts";

const ENABLE_STARTUP_BANNER = true;
const PLAIN_TIER_FULL_TEXT_MIN_WIDTH = 10;
const BYLINE = "by Grunert";

function subtitleLines(
  theme: Theme,
  model: string | undefined,
  width: number,
): string[] {
  const lines: string[] = [];

  const status = model
    ? `Mode • Model ${truncateModelName(model, 24)} • Thinking • Permissions`
    : "Mode • Model • Thinking • Permissions";
  if (status.length <= width) lines.push(theme.fg("muted", status));

  const commands = "/plan  /work  /review-plan  /permission  /subagent-list";
  if (commands.length <= width) lines.push(theme.fg("dim", commands));

  const shortcuts = "Shift+Tab: Mode    Ctrl+Shift+Y: Permissions";
  if (shortcuts.length <= width) lines.push(theme.fg("dim", shortcuts));

  return lines;
}

export default function startupBannerExtension(pi: ExtensionAPI): void {
  if (!ENABLE_STARTUP_BANNER) return;

  pi.on("session_start", async (_event, ctx) => {
    if (ctx.mode !== "tui") return;

    const model = ctx.model?.id;

    ctx.ui.setHeader((_tui, theme) => ({
      render(width: number): string[] {
        const colorMode = resolveBannerColorMode(theme.getColorMode());
        const tier = resolveBannerTier(width);

        if (tier === "plain") {
          const text =
            width >= PLAIN_TIER_FULL_TEXT_MIN_WIDTH ? "PI AGENT" : "PI";
          return [buildPlainBannerLine(text, colorMode)];
        }

        const glyphLines = buildBigBanner(
          tier === "full" ? "PI AGENT" : "PI",
          colorMode,
        );
        const byline = theme.fg("dim", BYLINE);
        const subtitle = subtitleLines(theme, model, width);
        return [
          ...glyphLines,
          byline,
          ...(subtitle.length > 0 ? ["", ...subtitle] : []),
        ];
      },
      invalidate() {},
    }));
  });
}
