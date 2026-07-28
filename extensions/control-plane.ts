/**
 * Global keyboard control plane.
 *
 * It owns shortcuts, never menus: Super+Q is an optional second door to the
 * one Control Center that plan-mode implements. Building a second overlay here
 * is exactly what let the two entry points drift apart before, so this file
 * deliberately holds no entry list of its own.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CONTROL_CENTER_EVENTS } from "./shared/control-center-events.ts";
import { SHORTCUTS } from "./shared/shortcuts.ts";

export default function controlPlaneExtension(pi: ExtensionAPI): void {
  pi.registerShortcut(SHORTCUTS.mainMenu.keys, {
    description: SHORTCUTS.mainMenu.description,
    handler: async (ctx) => {
      pi.events.emit(CONTROL_CENTER_EVENTS.open, { ctx });
    },
  });
}
