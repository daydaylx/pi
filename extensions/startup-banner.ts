/**
 * Startup-Banner Extension
 *
 * Zeigt beim Session-Start ein kompaktes PI AGENT-Banner als notify-Nachricht.
 * Kein Agent-Turn, keine Permissions-Änderung, kein Workflow-Eingriff.
 *
 * Deaktivieren: aus settings.json entfernen oder ENABLE_STARTUP_BANNER auf false setzen.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const ENABLE_STARTUP_BANNER = true;

export default function startupBannerExtension(pi: ExtensionAPI): void {
  if (!ENABLE_STARTUP_BANNER) return;

  let shown = false;

  pi.on("session_start", async (_event, ctx) => {
    if (shown) return;
    shown = true;

    const model = ctx.model?.id ?? "GLM-5.2";
    const banner = [
      "PI AGENT",
      `Plan • Work • Permissions • ${model}`,
      "/plan  /work  /review-plan  /permission",
      "Shift+Tab: Mode    Ctrl+Shift+Y: Permissions",
    ].join("\n");

    ctx.ui.notify(banner, "info");
  });
}
