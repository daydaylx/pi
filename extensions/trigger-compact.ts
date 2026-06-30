import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

const COMPACT_THRESHOLD_TOKENS = 60_000;

export default function (pi: ExtensionAPI) {
  // Prevent repeated triggers within one session; reset after compaction completes
  let hasTriggered = false;

  const triggerCompaction = (
    ctx: ExtensionContext,
    customInstructions?: string,
  ) => {
    if (ctx.hasUI)
      ctx.ui.notify("Auto-Kompaktierung gestartet (>60K Tokens)", "info");
    ctx.compact({
      customInstructions,
      onComplete: () => {
        hasTriggered = false;
        if (ctx.hasUI) ctx.ui.notify("Kompaktierung abgeschlossen", "info");
      },
      onError: (error) => {
        if (ctx.hasUI)
          ctx.ui.notify(
            `Kompaktierung fehlgeschlagen: ${error.message}`,
            "error",
          );
      },
    });
  };

  pi.on("turn_end", (_event, ctx) => {
    if (hasTriggered) return;
    const usage = ctx.getContextUsage();
    const currentTokens = usage?.tokens ?? null;
    if (currentTokens === null) return;

    if (currentTokens > COMPACT_THRESHOLD_TOKENS) {
      hasTriggered = true;
      triggerCompaction(ctx);
    }
  });

  pi.registerCommand("trigger-compact", {
    description: "Kompaktierung sofort starten",
    handler: async (args, ctx) => {
      const instructions = args.trim() || undefined;
      hasTriggered = false;
      triggerCompaction(ctx, instructions);
    },
  });
}
