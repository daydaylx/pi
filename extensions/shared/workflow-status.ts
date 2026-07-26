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
  "read-only" | "read-bash" | "read-write" | "full-access" | "yolo";

export type PermissionState = "DEFAULT" | "MANUAL" | "YOLO_OVERRIDE";

export const PERMISSION_LEVEL_LABEL: Record<PermissionLevel, string> = {
  "read-only": "Nur Lesen",
  "read-bash": "Lesen + Bash-Info",
  "read-write": "Lesen + Schreiben",
  "full-access": "Vollzugriff",
  yolo: "YOLO",
};

export const PERMISSION_LEVEL_DESCRIPTION: Record<PermissionLevel, string> = {
  "read-only": "Nur Lesen; ausschließlich die Plan-Datei bleibt beschreibbar",
  "read-bash": "Lesen, sichere Inspect-Bash-Befehle und die Plan-Datei",
  "read-write": "Normaler Projektzugriff mit Rückfragen bei riskanten Aktionen",
  "full-access":
    "Git-Housekeeping/Paketmanager ohne Rückfrage; sudo/Löschen/Force-Push bleiben bestätigt",
  yolo: "Vollständiger Policy- und Workflow-Bypass ohne Rückfragen",
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

export type PermissionRiskStatusValue =
  | "🛡 DEFAULT · READ ONLY"
  | "🛡 DEFAULT · READ + BASH"
  | "🛡 DEFAULT · READ + WRITE"
  | "🛡 MANUELL · READ ONLY"
  | "🛡 MANUELL · READ + BASH"
  | "🛡 MANUELL · READ + WRITE"
  | "⚠ VOLLZUGRIFF"
  | "⚠ YOLO · VOLL-BYPASS";

export function permissionRiskStatusValue(
  level: PermissionLevel,
  state: PermissionState = "DEFAULT",
): PermissionRiskStatusValue {
  const prefix = state === "MANUAL" ? "🛡 MANUELL" : "🛡 DEFAULT";
  switch (level) {
    case "read-only":
      return `${prefix} · READ ONLY` as PermissionRiskStatusValue;
    case "read-bash":
      return `${prefix} · READ + BASH` as PermissionRiskStatusValue;
    case "read-write":
      return `${prefix} · READ + WRITE` as PermissionRiskStatusValue;
    case "full-access":
      return "⚠ VOLLZUGRIFF";
    case "yolo":
      return "⚠ YOLO · VOLL-BYPASS";
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
