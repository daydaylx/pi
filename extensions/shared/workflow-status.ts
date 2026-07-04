import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export const WORKFLOW_STATUS_EVENT = "pi-workflow:status";
export const WORKFLOW_MODE_REQUEST_EVENT = "pi-workflow:set-mode";
export const PERMISSION_REQUEST_EVENT = "pi-workflow:set-permission";

export type WorkflowMode = "work" | "simple_plan" | "detailed_plan";

export type WorkflowPhase =
  "idle" | "draft" | "reviewing" | "reviewed" | "executing" | "ready";

// Die Zugriffsstufe ist orthogonal zum Workflow-Modus. Planvarianten steuern
// Prompting und Workflow; ausschließlich diese Stufe steuert Tool-Zugriffe.
export type PermissionLevel =
  "read-only" | "read-bash" | "read-write" | "full-access" | "yolo";

export const PERMISSION_LEVEL_LABEL: Record<PermissionLevel, string> = {
  "read-only": "Read only",
  "read-bash": "Read + Bash Info Commands",
  "read-write": "Read + Write",
  "full-access": "Full Access",
  yolo: "YOLO",
};

export const PERMISSION_LEVEL_DESCRIPTION: Record<PermissionLevel, string> = {
  "read-only": "Nur Lesen; ausschließlich die Plan-Datei bleibt beschreibbar",
  "read-bash": "Lesen, sichere Inspect-Bash-Befehle und die Plan-Datei",
  "read-write": "Normaler Projektzugriff mit Rückfragen bei riskanten Aktionen",
  "full-access":
    "Git-Housekeeping/Paketmanager ohne Rückfrage; sudo/Löschen bleiben bestätigt",
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

export const WORKFLOW_MODE_LABEL: Record<WorkflowPhase, string> = {
  idle: "WORK",
  draft: "PLAN",
  reviewing: "REVIEW",
  reviewed: "REVIEWED",
  executing: "WORK",
  ready: "READY",
};
