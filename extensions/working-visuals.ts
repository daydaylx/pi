/**
 * Working-Visuals Extension
 *
 * Setzt beim Session-Start einen dezenten, lebendigen Working-Indicator
 * (`ctx.ui.setWorkingIndicator`), der nur in interaktiven TTY-Kontexten
 * animiert ist. In CI, non-TUI, TERM=dumb, NO_COLOR oder bei explizitem
 * Reduced-Motion-Flag (PI_REDUCED_MOTION / PI_DISABLE_ANIMATIONS) fällt er
 * auf einen ruhigen statischen Punkt bzw. gar keine Frames zurück.
 *
 * Keine Daueranimation, kein Blinken nach Task-Ende — nur das, was Pi ohnehin
 * während des Streamings als Working-Indicator anzeigt.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  resolveRenderProfile,
  type RenderProfile,
} from "./shared/render-profile.ts";

function framesForProfile(profile: RenderProfile, theme: {
  fg(color: string, text: string): string;
}): string[] {
  if (!profile.animations) {
    return profile.color ? [theme.fg("accent", "●")] : ["*"];
  }
  if (!profile.color) {
    return ["|", "/", "-", "\\"];
  }
  return [
    theme.fg("dim", "·"),
    theme.fg("muted", "•"),
    theme.fg("accent", "●"),
    theme.fg("muted", "•"),
  ];
}

export default function workingVisualsExtension(pi: ExtensionAPI): void {
  pi.on("session_start", async (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    const theme = ctx.ui.theme;
    const profile = resolveRenderProfile({ mode: ctx.mode });
    const frames = framesForProfile(profile, theme);
    if (frames.length === 0) {
      ctx.ui.setWorkingIndicator({ frames: [] });
      return;
    }
    ctx.ui.setWorkingIndicator({
      frames,
      intervalMs: profile.animations ? 140 : undefined,
    });
  });
}
