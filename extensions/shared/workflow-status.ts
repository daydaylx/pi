export const WORKFLOW_STATUS_EVENT = "pi-workflow:status";

export type BaseMode = "plan" | "work";
export type Escalation = "none" | "full-access" | "yolo";
export type RuntimeMode = BaseMode | "full-access" | "yolo";

export type WorkflowPhase =
  "idle" | "draft" | "reviewing" | "reviewed" | "executing" | "ready";

// Feingranulare Zugriffsstufe, wie sie im zentralen Menü angezeigt/gewählt
// wird. Bildet sich aus (baseMode, planStrict) für Plan und aus (baseMode,
// escalation) für Work ab — siehe mode-permissions.ts.
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
  "read-only": "Nur Lesen, kein Bash — striktester Plan Mode",
  "read-bash": "Lesen + sichere Inspect-Bash-Befehle (Plan Mode Standard)",
  "read-write": "Normaler Projektzugriff mit Rückfragen (Work Mode Standard)",
  "full-access":
    "Work + Git-Housekeeping/Paketmanager ohne Rückfrage; sudo/Löschen bleiben bestätigt",
  yolo: "Work + sudo/Löschen/externe Schreibzugriffe ohne Rückfrage; kritische Muster bleiben bestätigt",
};

// Schreibrechte-Override, unabhängig vom Modus zuschaltbar (nur wirksam
// außerhalb von Plan Mode — Plan Mode erzwingt "nur Plan-Datei" immer selbst).
export type WriteOverride = "inherit" | "block" | "plan-file-only";

export type WorkflowStatusEvent =
  | {
      source: "plan";
      baseMode: BaseMode;
      phase: WorkflowPhase;
      planningActive: boolean;
      planExists: boolean;
      completedTodos: number;
      totalTodos: number;
    }
  | {
      source: "permission";
      mode: RuntimeMode;
      baseMode: BaseMode;
      yolo: boolean;
      escalation: Escalation;
      planStrict: boolean;
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
