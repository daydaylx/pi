import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

/**
 * Narrow in-process contract for the temporary Shift+Tab Control Center.
 * Domain extensions own their state and menus; plan-mode only routes entries.
 */
export const CONTROL_CENTER_EVENTS = {
  /** Opens the one Control Center. Optional entry points emit this. */
  open: "control-center:open",
  openPermissions: "control-center:open-permissions",
  openModels: "control-center:open-models",
  openThinking: "control-center:open-thinking",
  openDiagnostics: "control-center:open-diagnostics",
  workflowThinkingDefault: "control-center:workflow-thinking-default",
} as const;

export interface OpenControlCenterMenuEvent {
  ctx: ExtensionContext;
}

export interface WorkflowThinkingDefaultEvent {
  respond: (value: { mode: string; defaultLevel: ThinkingLevel }) => void;
}
