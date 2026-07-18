import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PermissionLevel } from "./workflow-status.ts";

/**
 * Narrow in-process contract for the temporary Shift+Tab Control Center.
 * Domain extensions own their state and menus; plan-mode only routes entries.
 */
export const CONTROL_CENTER_EVENTS = {
  openPermissions: "control-center:open-permissions",
  openThinking: "control-center:open-thinking",
  openThinkingView: "control-center:open-thinking-view",
  openDiagnostics: "control-center:open-diagnostics",
  snapshot: "control-center:snapshot",
  workflowThinkingDefault: "control-center:workflow-thinking-default",
} as const;

export interface ControlCenterSnapshot {
  permissionLevel: PermissionLevel;
  permissionLabel: string;
  thinkingMode: "auto" | "manual";
  thinkingLevel: ThinkingLevel;
}

export interface OpenControlCenterMenuEvent {
  ctx: ExtensionContext;
}

export interface ControlCenterSnapshotEvent {
  respond: (snapshot: ControlCenterSnapshot) => void;
}

export interface WorkflowThinkingDefaultEvent {
  respond: (value: { mode: string; defaultLevel: ThinkingLevel }) => void;
}
