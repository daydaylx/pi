/**
 * Global keyboard control plane.
 *
 * It owns shortcuts and the `/commands` entry point, never menu contents.
 * Every binding submits its canonical slash command, so keyboard,
 * autocomplete and menu entry cannot drift apart.
 */
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { CommandEffect } from "./shared/command-catalog.ts";
import { catalogDescription } from "./shared/command-catalog.ts";
import { openCommandCenter } from "./shared/command-center.ts";
import { submitCanonicalCommand } from "./shared/command-runtime.ts";
import { SHORTCUTS } from "./shared/shortcuts.ts";

export default function controlPlaneExtension(pi: ExtensionAPI): void {
  pi.registerCommand("commands", {
    description: catalogDescription("commands"),
    handler: async (_args, ctx) => openCommandCenter(pi, ctx),
  });
  let shortcutDispatchInFlight = false;
  for (const binding of Object.values(SHORTCUTS)) {
    pi.registerShortcut(binding.keys, {
      description: binding.description,
      handler: async (ctx: ExtensionContext) => {
        if (shortcutDispatchInFlight) return;
        shortcutDispatchInFlight = true;
        try {
          await submitCanonicalCommand(
            ctx,
            binding.command,
            (binding as { effect?: CommandEffect }).effect ?? "preserve-draft",
          );
        } finally {
          shortcutDispatchInFlight = false;
        }
      },
    });
  }
}
