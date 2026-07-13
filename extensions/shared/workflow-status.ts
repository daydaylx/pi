import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export const WORKFLOW_STATUS_EVENT = "pi-workflow:status";

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
    "Git-Housekeeping/Paketmanager ohne Rückfrage; sudo/Löschen/Force-Push bleiben bestätigt",
  yolo: "sudo/Löschen/externe Schreibzugriffe ohne Rückfrage; kritische Muster bleiben bestätigt",
};

/**
 * Converts persisted legacy permission values before they reach the policy.
 * `test-bash` was intentionally removed because its curated command list was
 * difficult to keep complete and safe; its conservative replacement is the
 * existing read-only Bash policy.
 */
export function normalizePermissionLevel(
  value: unknown,
): PermissionLevel | undefined {
  if (value === "test-bash") return "read-bash";
  return typeof value === "string" &&
    Object.hasOwn(PERMISSION_LEVEL_LABEL, value)
    ? (value as PermissionLevel)
    : undefined;
}

export const ZENTUI_STATUS_KEYS = {
  permissions: "permissions",
  workflow: "workflow",
  plan: "plan",
  subagents: "subagents",
} as const;

export type PermissionStatusBase = "RO" | "RB" | "RW" | "FA" | "YOLO";

export type PermissionStatusValue =
  | PermissionStatusBase
  | "RO·LOCK"
  | "RB·LOCK"
  | "RW·LOCK"
  | "FA·LOCK"
  | "YOLO·LOCK"
  | "RO·PLAN"
  | "RB·PLAN"
  | "RW·PLAN"
  | "FA·PLAN"
  | "YOLO·PLAN";

export function permissionStatusValue(
  level: PermissionLevel,
  writeOverride: WriteOverride = "inherit",
): PermissionStatusValue {
  const base: PermissionStatusBase = (() => {
    switch (level) {
      case "read-only":
        return "RO";
      case "read-bash":
        return "RB";
      case "read-write":
        return "RW";
      case "full-access":
        return "FA";
      case "yolo":
        return "YOLO";
    }
  })();
  if (writeOverride === "block") return `${base}·LOCK` as PermissionStatusValue;
  if (writeOverride === "plan-file-only") {
    return `${base}·PLAN` as PermissionStatusValue;
  }
  return base;
}

export type WorkflowStatusValue =
  "PLAN" | "WORK" | "REVIEW" | "ANALYZE" | "SKILL";

export function workflowStatusValue(
  phase: WorkflowPhase,
): Exclude<WorkflowStatusValue, "SKILL"> {
  switch (phase) {
    case "draft":
      return "PLAN";
    case "deciding":
      return "ANALYZE";
    case "reviewing":
    case "reviewed":
      return "REVIEW";
    case "idle":
    case "executing":
    case "ready":
      return "WORK";
  }
}

/** Status values are presentation-only and must never leak into non-TUI modes. */
export function setTuiStatus(
  ctx: ExtensionContext,
  key: string,
  value: string | undefined,
): void {
  if (ctx.mode !== "tui" || !ctx.hasUI) return;
  const ui = ctx.ui as typeof ctx.ui & {
    setStatus?: (statusKey: string, statusValue: string | undefined) => void;
  };
  ui.setStatus?.(key, value);
}

// Zusätzlicher Schreibrechte-Override. Die restriktivere Regel aus
// Permission-Level und Override gewinnt.
export type WriteOverride = "inherit" | "block" | "plan-file-only";

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

export const SKILL_LAUNCHER_REQUEST_EVENT = "pi-workflow:skill-launcher";

export interface SkillLauncherRequest {
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
