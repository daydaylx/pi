/**
 * Startup-Banner: beim Start groß, danach platzsparend und modellaktuell.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  buildBigBanner,
  buildPlainBannerLine,
  resolveBannerColorMode,
  resolveBannerTier,
} from "./shared/banner-render.ts";
import { truncateModelName } from "./shared/render-profile.ts";
import { loadUiConfig } from "./shared/ui-config.ts";

type BannerMode = "on" | "compact" | "off";

const PLAIN_TIER_FULL_TEXT_MIN_WIDTH = 10;
const BYLINE = "by Grunert";

export default function startupBannerExtension(pi: ExtensionAPI): void {
  let bannerMode: BannerMode = loadUiConfig().banner;
  let collapsed = bannerMode !== "on";
  let modelId: string | undefined;
  let activeCtx: any;
  let headerTui: { requestRender(): void } | undefined;

  function refresh(): void {
    headerTui?.requestRender();
  }

  function installHeader(ctx: any): void {
    activeCtx = ctx;
    ctx.ui.setHeader((tui: any, theme: any) => {
      headerTui = tui;
      return {
        render(width: number): string[] {
          if (bannerMode === "off") return [];

          const colorMode = resolveBannerColorMode(theme.getColorMode());
          if (bannerMode === "compact" || collapsed) {
            const label = modelId
              ? `PI AGENT · ${truncateModelName(modelId, Math.max(8, width - 13))}`
              : "PI AGENT";
            return [theme.fg("muted", label.slice(0, Math.max(1, width)))];
          }

          const tier = resolveBannerTier(width);
          if (tier === "plain") {
            const text =
              width >= PLAIN_TIER_FULL_TEXT_MIN_WIDTH ? "PI AGENT" : "PI";
            return [buildPlainBannerLine(text, colorMode)];
          }

          return [
            ...buildBigBanner(tier === "full" ? "PI AGENT" : "PI", colorMode),
            theme.fg("dim", BYLINE),
          ];
        },
        invalidate() {},
      };
    });
  }

  pi.on("session_start", async (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    bannerMode = loadUiConfig().banner;
    collapsed = bannerMode !== "on";
    modelId = ctx.model?.id;
    installHeader(ctx);
  });

  pi.on("input", async () => {
    if (bannerMode === "on" && !collapsed) {
      collapsed = true;
      refresh();
    }
    return { action: "continue" } as const;
  });

  pi.on("model_select", async (_event, ctx) => {
    modelId = ctx.model?.id;
    refresh();
  });

  pi.on("session_shutdown", async () => {
    activeCtx = undefined;
    headerTui = undefined;
  });

  pi.registerCommand("banner", {
    description: "Startbanner steuern: on | compact | off",
    handler: async (args, ctx) => {
      const requested = args.trim().toLowerCase();
      if (
        requested !== "on" &&
        requested !== "compact" &&
        requested !== "off"
      ) {
        ctx.ui.notify("Nutzung: /banner on|compact|off", "info");
        return;
      }
      bannerMode = requested;
      collapsed = requested !== "on";
      if (ctx.mode === "tui" && activeCtx !== ctx) installHeader(ctx);
      refresh();
      const label =
        requested === "on"
          ? "groß bis zur nächsten Eingabe"
          : requested === "compact"
            ? "kompakt"
            : "aus";
      ctx.ui.notify(`Startbanner: ${label}.`, "info");
    },
  });
}
