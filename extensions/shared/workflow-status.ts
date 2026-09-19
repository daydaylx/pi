import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
export type { WorkflowMode } from "./workflow-mode.ts";

// Die Zugriffsstufe ist orthogonal zum Workflow-Modus. Planvarianten steuern
// Prompting und Workflow; ausschließlich diese Stufe steuert Tool-Zugriffe.
export type PermissionLevel =
  | "readonly"
  | "project-write"
  | "confirm-all"
  | "yolo"
  | "yolo-ask"
  | "yolo-full"
  | "headless";

/**
 * YOLO ist ein temporärer Bypass in drei Stufen (aufsteigender Zugriff):
 *   yolo       Stufe 1 — Bypass innerhalb der harten Grenzen (unverändert)
 *   yolo-ask   Stufe 2 — wie Stufe 1, aber jede harte Grenze fragt statt zu
 *              blockieren
 *   yolo-full  Stufe 3 — voller Zugriff inkl. sudo, Secrets, Systempfade
 * Alle drei sind reine Effektivstufen und werden nie persistiert.
 */
export type YoloLevel = "yolo" | "yolo-ask" | "yolo-full";

export const YOLO_LEVELS: readonly YoloLevel[] = [
  "yolo",
  "yolo-ask",
  "yolo-full",
];

export function isYoloLevel(
  level: PermissionLevel | undefined,
): level is YoloLevel {
  return level === "yolo" || level === "yolo-ask" || level === "yolo-full";
}

/** Maps `/yolo <arg>` to a stufe; undefined when the argument is unknown. */
export function parseYoloLevel(arg: string): YoloLevel | undefined {
  switch (arg.trim().toLowerCase()) {
    case "1":
    case "yolo":
      return "yolo";
    case "2":
    case "ask":
    case "yolo-ask":
      return "yolo-ask";
    case "3":
    case "full":
    case "yolo-full":
      return "yolo-full";
    default:
      return undefined;
  }
}

export type PermissionState = "DEFAULT" | "MANUAL" | "YOLO_OVERRIDE";

export const PERMISSION_LEVEL_LABEL: Record<PermissionLevel, string> = {
  readonly: "Nur Lesen",
  "project-write": "Projekt schreiben",
  "confirm-all": "Alles bestätigen",
  yolo: "YOLO 1 · Projekt",
  "yolo-ask": "YOLO 2 · Mit Rückfrage",
  "yolo-full": "YOLO 3 · Voller Zugriff",
  headless: "Headless",
};

export const PERMISSION_LEVEL_DESCRIPTION: Record<PermissionLevel, string> = {
  readonly:
    "Projekt lesen und sichere Inspect-Shell nutzen; nur der Plan ist in der Planung beschreibbar",
  "project-write":
    "Gewöhnliche Projektänderungen; riskante, destruktive und externe Aktionen bestätigen",
  "confirm-all": "Jede Mutation und jede externe Aktion einzeln bestätigen",
  yolo: "Temporärer sichtbarer Bypass ohne Rückfragen im Projekt; harte Secret-, System-, Symlink- und Trust-Grenzen sowie der Plan-Mode-Schreibschutz bleiben aktiv",
  "yolo-ask":
    "Wie YOLO 1, aber mehr Zugriff mit Erlaubnis: sudo, Systempfade, Secrets, Pfade außerhalb des Projekts und opake Interpreter fragen einzeln nach",
  "yolo-full":
    "Temporärer Vollzugriff ohne Rückfragen, auch sudo, Systempfade, Secrets und Pfade außerhalb des Projekts; nur Trust-Grenze und Plan-Mode-Schreibschutz bleiben aktiv",
  headless:
    "Ohne Bestätigungsdialog (kein TUI-Kanal vorhanden): projektlokale Builds/Tests/Lint/Typecheck erlaubt, jede sonst bestätigungspflichtige Aktion bricht strukturiert ab statt zu fragen",
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
  if (value === "yolo" || value === "yolo-ask" || value === "yolo-full")
    return "project-write";
  return typeof value === "string" &&
    Object.hasOwn(PERMISSION_LEVEL_LABEL, value)
    ? (value as PermissionLevel)
    : undefined;
}

export const UI_STATUS_KEYS = {
  permissions: "permissions",
  workflow: "workflow",
  recovery: "recovery",
} as const;

export type PermissionRiskStatusValue =
  | "🛡 DEFAULT · READONLY"
  | "🛡 DEFAULT · PROJECT WRITE"
  | "🛡 DEFAULT · CONFIRM ALL"
  | "🛡 DEFAULT · HEADLESS"
  | "🛡 MANUELL · READONLY"
  | "🛡 MANUELL · PROJECT WRITE"
  | "🛡 MANUELL · CONFIRM ALL"
  | "🛡 MANUELL · HEADLESS"
  | "⚠ YOLO · TEMPORÄR"
  | "⚠ YOLO 2 · MIT RÜCKFRAGE"
  | "⚠ YOLO 3 · VOLLZUGRIFF";

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
    case "headless":
      return `${prefix} · HEADLESS` as PermissionRiskStatusValue;
    case "yolo":
      return "⚠ YOLO · TEMPORÄR";
    case "yolo-ask":
      return "⚠ YOLO 2 · MIT RÜCKFRAGE";
    case "yolo-full":
      return "⚠ YOLO 3 · VOLLZUGRIFF";
  }
}

/**
 * TUI status values are presentation-only and must never leak into non-TUI
 * modes.
 */
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
