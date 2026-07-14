import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

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
} as const;

/** Only elevated permission modes belong in the compact footer. */
export type PermissionRiskStatusValue = "⚠ FULL ACCESS" | "⚠ YOLO";

export function permissionRiskStatusValue(
  level: PermissionLevel,
): PermissionRiskStatusValue | undefined {
  switch (level) {
    case "full-access":
      return "⚠ FULL ACCESS";
    case "yolo":
      return "⚠ YOLO";
    default:
      return undefined;
  }
}

export type WorkflowProgressItem = {
  completed: boolean;
};

export type WorkflowStatusValue = string;

export function workflowStatusValue(
  phase: WorkflowPhase,
  mode: WorkflowMode = "work",
  todos: readonly WorkflowProgressItem[] = [],
): WorkflowStatusValue {
  switch (phase) {
    case "draft":
      return mode === "detailed_plan" ? "ARCH PLAN" : "PLAN";
    case "deciding":
      return "ANALYZE";
    case "reviewing":
    case "reviewed":
      return "REVIEW";
    case "executing": {
      const total = todos.length;
      if (total === 0) return "WORK";
      const completed = todos.filter((todo) => todo.completed).length;
      return `WORK ${completed}/${total}`;
    }
    case "idle":
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
