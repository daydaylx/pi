import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export type WorkflowMode = "work" | "simple_plan" | "detailed_plan";

export type WorkflowPhase =
  | "idle"
  | "draft"
  | "deciding"
  | "reviewing"
  | "reviewed"
  | "executing"
  | "paused"
  | "blocked"
  | "ready";

// Die Zugriffsstufe ist orthogonal zum Workflow-Modus. Planvarianten steuern
// Prompting und Workflow; ausschließlich diese Stufe steuert Tool-Zugriffe.
export type PermissionLevel =
  "readonly" | "project-write" | "confirm-all" | "yolo";

export type PermissionState = "DEFAULT" | "MANUAL" | "YOLO_OVERRIDE";

export const PERMISSION_LEVEL_LABEL: Record<PermissionLevel, string> = {
  readonly: "Nur Lesen",
  "project-write": "Projekt schreiben",
  "confirm-all": "Alles bestätigen",
  yolo: "YOLO",
};

export const PERMISSION_LEVEL_DESCRIPTION: Record<PermissionLevel, string> = {
  readonly:
    "Projekt lesen und sichere Inspect-Shell nutzen; nur der Plan ist in der Planung beschreibbar",
  "project-write":
    "Gewöhnliche Projektänderungen; riskante, destruktive und externe Aktionen bestätigen",
  "confirm-all":
    "Jede Mutation und jede externe Aktion einzeln bestätigen",
  yolo:
    "Temporärer sichtbarer Bypass; harte Secret-, System-, Symlink- und Trust-Grenzen bleiben aktiv",
};

/**
 * Converts persisted legacy permission values before they reach the policy.
 * Legacy values are accepted only at input boundaries and mapped to the
 * nearest conservative v3 mode.
 */
export function normalizePermissionLevel(
  value: unknown,
): PermissionLevel | undefined {
  if (value === "read-only" || value === "read-bash" || value === "test-bash")
    return "readonly";
  if (value === "read-write") return "project-write";
  if (value === "full-access") return "confirm-all";
  if (value === "yolo") return "project-write";
  return typeof value === "string" &&
    Object.hasOwn(PERMISSION_LEVEL_LABEL, value)
    ? (value as PermissionLevel)
    : undefined;
}

export const ZENTUI_STATUS_KEYS = {
  permissions: "permissions",
  workflow: "workflow",
} as const;

export type PermissionRiskStatusValue =
  | "🛡 DEFAULT · READONLY"
  | "🛡 DEFAULT · PROJECT WRITE"
  | "🛡 DEFAULT · CONFIRM ALL"
  | "🛡 MANUELL · READONLY"
  | "🛡 MANUELL · PROJECT WRITE"
  | "🛡 MANUELL · CONFIRM ALL"
  | "⚠ YOLO · TEMPORÄR";

export function permissionRiskStatusValue(
  level: PermissionLevel,
  state: PermissionState = "DEFAULT",
): PermissionRiskStatusValue {
  const prefix = state === "MANUAL" ? "🛡 MANUELL" : "🛡 DEFAULT";
  switch (level) {
    case "readonly":
      return `${prefix} · READONLY` as PermissionRiskStatusValue;
    case "project-write":
      return `${prefix} · PROJECT WRITE` as PermissionRiskStatusValue;
    case "confirm-all":
      return `${prefix} · CONFIRM ALL` as PermissionRiskStatusValue;
    case "yolo":
      return "⚠ YOLO · TEMPORÄR";
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
      return mode === "detailed_plan"
        ? "ARCHITEKTURPLAN"
        : mode === "simple_plan"
          ? "PLAN"
          : "ARBEIT · PLAN GESPEICHERT";
    case "deciding":
      return "ANALYSE";
    case "reviewing":
    case "reviewed":
      return "REVIEW";
    case "executing": {
      const total = todos.length;
      if (total === 0) return "ARBEIT";
      const completed = todos.filter((todo) => todo.completed).length;
      return `ARBEIT ${completed}/${total}`;
    }
    case "paused": {
      const total = todos.length;
      const completed = todos.filter((todo) => todo.completed).length;
      return total > 0 ? `PAUSIERT ${completed}/${total}` : "PAUSIERT";
    }
    case "blocked": {
      const total = todos.length;
      const completed = todos.filter((todo) => todo.completed).length;
      return total > 0 ? `BLOCKIERT ${completed}/${total}` : "BLOCKIERT";
    }
    case "ready":
      return "BEREIT";
    case "idle":
      return "ARBEIT";
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
