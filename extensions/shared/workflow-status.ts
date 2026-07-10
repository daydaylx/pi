import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export const WORKFLOW_STATUS_EVENT = "pi-workflow:status";
export const WORKFLOW_MODE_REQUEST_EVENT = "pi-workflow:set-mode";
export const PERMISSION_REQUEST_EVENT = "pi-workflow:set-permission";

export type WorkflowMode = "work" | "simple_plan" | "detailed_plan";

export type WorkflowPhase =
  | "idle"
  | "draft"
  | "deciding"
  | "reviewing"
  | "reviewed"
  | "executing"
  | "ready";

// Die Zugriffsstufe ist orthogonal zum Workflow-Modus. Planvarianten steuern
// Prompting und Workflow; ausschließlich diese Stufe steuert Tool-Zugriffe.
export type PermissionLevel =
  "read-only" | "read-bash" | "test-bash" | "read-write" | "full-access" | "yolo";

export const PERMISSION_LEVEL_LABEL: Record<PermissionLevel, string> = {
  "read-only": "Read only",
  "read-bash": "Read + Bash Info Commands",
  "test-bash": "Read + Test/Run Commands",
  "read-write": "Read + Write",
  "full-access": "Full Access",
  yolo: "YOLO",
};

export const PERMISSION_LEVEL_DESCRIPTION: Record<PermissionLevel, string> = {
  "read-only": "Nur Lesen; ausschließlich die Plan-Datei bleibt beschreibbar",
  "read-bash": "Lesen, sichere Inspect-Bash-Befehle und die Plan-Datei",
  "test-bash": "Lesen, Inspect- und Test-Befehle (npm test, tsc --noEmit) und die Plan-Datei",
  "read-write": "Normaler Projektzugriff mit Rückfragen bei riskanten Aktionen",
  "full-access":
    "Git-Housekeeping/Paketmanager ohne Rückfrage; sudo/Löschen/Force-Push bleiben bestätigt",
  yolo: "sudo/Löschen/externe Schreibzugriffe ohne Rückfrage; kritische Muster bleiben bestätigt",
};

// Zusätzlicher Schreibrechte-Override. Die restriktivere Regel aus
// Permission-Level und Override gewinnt.
export type WriteOverride = "inherit" | "block" | "plan-file-only";

export interface WorkflowModeRequest {
  mode: WorkflowMode;
  ctx: ExtensionContext;
}

export interface PermissionRequest {
  level: PermissionLevel;
  ctx: ExtensionContext;
}

export const WRITE_OVERRIDE_REQUEST_EVENT = "pi-workflow:set-write-override";

export interface WriteOverrideRequest {
  override: WriteOverride;
  ctx: ExtensionContext;
}

export const WRITE_OVERRIDE_LABEL: Record<WriteOverride, string> = {
  inherit: "Standard der Permission-Stufe",
  block: "Blockiert",
  "plan-file-only": "Nur Plan-Datei",
};

export const WRITE_OVERRIDE_DESCRIPTION: Record<WriteOverride, string> = {
  inherit:
    "Schreibrechte folgen der aktuellen Permission-Stufe ohne Zusatzbeschränkung",
  block:
    "Jeglicher Schreibzugriff ist blockiert, unabhängig von der Permission-Stufe",
  "plan-file-only":
    "Nur die Plan-Datei bleibt beschreibbar, alle anderen Schreibzugriffe sind blockiert",
};

export const PLAN_ACTION_REQUEST_EVENT = "pi-workflow:plan-action";

// "decide" startet den Decision-Intake sofort (triggerTurn, z. B. /decide,
// /plan-Aktion, Ctrl+Shift+X). "decide-mode" wechselt nur still in den
// Klär-Modus (phase=deciding) ohne sofortigen Prompt — genutzt vom
// Shift+Tab-Modusmenü, analog zu den anderen Plan-Modi.
export type PlanAction =
  | "choose"
  | "work"
  | "review"
  | "finish"
  | "decide"
  | "decide-mode";

export interface PlanActionRequest {
  action: PlanAction;
  ctx: ExtensionContext;
}

export const TOOLS_ACTION_REQUEST_EVENT = "pi-workflow:tools-action";

export type ToolsAction = "open" | "enable-all" | "disable-all";

export interface ToolsActionRequest {
  action: ToolsAction;
  ctx: ExtensionContext;
}

export const STATUS_REQUEST_EVENT = "pi-workflow:show-status";

export interface StatusRequest {
  ctx: ExtensionContext;
}

export type WorkflowStatusEvent =
  | {
      source: "plan";
      mode: WorkflowMode;
      phase: WorkflowPhase;
      planExists: boolean;
      completedTodos: number;
      totalTodos: number;
    }
  | {
      source: "permission";
      writeOverride: WriteOverride;
      permissionLevel: PermissionLevel;
    };

export const WORKFLOW_PHASE_LABEL: Record<WorkflowPhase, string> = {
  idle: "WORK",
  draft: "PLAN",
  deciding: "DECIDE",
  reviewing: "REVIEW",
  reviewed: "REVIEWED",
  executing: "WORK",
  ready: "READY",
};

export const WORKFLOW_MODE_LABEL: Record<WorkflowMode, string> = {
  work: "Work",
  simple_plan: "Schnellplan",
  detailed_plan: "Architekturplan",
};
