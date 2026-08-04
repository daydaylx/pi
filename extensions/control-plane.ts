/**
 * Global keyboard control plane.
 *
 * It owns shortcuts, never menus. Every binding submits its canonical slash
 * command, so keyboard, autocomplete and menu entry cannot drift apart.
 */
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { submitCanonicalCommand } from "./shared/command-runtime.ts";
import { SHORTCUTS } from "./shared/shortcuts.ts";

export default function controlPlaneExtension(pi: ExtensionAPI): void {
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
            "effect" in binding ? binding.effect : "preserve-draft",
          );
        } finally {
          shortcutDispatchInFlight = false;
        }
      },
    });
  }
}
