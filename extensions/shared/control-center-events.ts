import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

/** Compatibility events plus the workflow/thinking capability bridge. */
export const CONTROL_CENTER_EVENTS = {
  openPermissions: "control-center:open-permissions",
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
