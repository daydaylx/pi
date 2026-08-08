import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

/** Compatibility events. */
export const CONTROL_CENTER_EVENTS = {
  openPermissions: "control-center:open-permissions",
  openThinking: "control-center:open-thinking",
  openDiagnostics: "control-center:open-diagnostics",
} as const;

export interface OpenControlCenterMenuEvent {
  ctx: ExtensionContext;
}
