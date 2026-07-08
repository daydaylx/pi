import { homedir } from "node:os";
import { basename, dirname, normalize } from "node:path";
import type { PermissionLevel, WorkflowMode, WorkflowPhase } from "./workflow-status.ts";
import { PERMISSION_LEVEL_LABEL, WORKFLOW_PHASE_LABEL } from "./workflow-status.ts";

export type VisualTone = "neutral" | "plan" | "review" | "work" | "warning" | "danger" | "success";

export interface VisualWorkflowState {
  mode: WorkflowMode;
  phase: WorkflowPhase;
  permissionLevel: PermissionLevel;
  planExists: boolean;
  completedTodos: number;
  totalTodos: number;
  model?: string;
  thinking?: string;
  nextStep: string;
}

export interface WorkProgressItem {
  step: number;
  text: string;
  completed: boolean;
  blocked?: boolean;
  failed?: boolean;
  running?: boolean;
}

export function projectLabel(cwd: string): string {
  const home = normalize(homedir());
  const normalized = normalize(cwd);
  if (normalized === home) return "~";
  if (normalized.startsWith(`${home}/`)) return `~/${normalized.slice(home.length + 1)}`;
  const parent = basename(dirname(normalized));
  const leaf = basename(normalized);
  return parent && parent !== "." ? `${parent}/${leaf}` : leaf;
}

export function phaseTone(phase: WorkflowPhase, mode: WorkflowMode): VisualTone {
  if (phase === "reviewing" || phase === "reviewed") return "review";
  if (phase === "executing" || phase === "ready") return "work";
  if (phase === "deciding") return "plan";
  if (mode === "simple_plan" || mode === "detailed_plan" || phase === "draft") return "plan";
  return "neutral";
}

export function permissionTone(level: PermissionLevel): VisualTone {
  if (level === "yolo") return "danger";
  if (level === "full-access") return "warning";
  if (level === "read-only" || level === "read-bash") return "review";
  return "neutral";
}

export function toneColor(tone: VisualTone): "text" | "accent" | "warning" | "error" | "success" | "muted" {
  switch (tone) {
    case "plan":
      return "accent";
    case "review":
    case "warning":
      return "warning";
    case "danger":
      return "error";
    case "work":
    case "success":
      return "success";
    case "neutral":
    default:
      return "text";
  }
}

export function formatModePhase(state: Pick<VisualWorkflowState, "mode" | "phase">): string {
  const phase = WORKFLOW_PHASE_LABEL[state.phase];
  if (state.mode === "simple_plan") return `PLAN · ${phase === "PLAN" ? "DRAFT" : phase}`;
  if (state.mode === "detailed_plan") return `ARCH · ${phase === "PLAN" ? "DRAFT" : phase}`;
  // Work mode: show phase only for idle/ready, otherwise just "WORK"
  if (state.phase === "idle" || state.phase === "ready") return phase;
  return "WORK";
}

export function formatTodoSummary(completed: number, total: number): string {
  if (total <= 0) return "NO TODO";
  const open = Math.max(0, total - completed);
  return open === 0 ? `${total} TODO ✓` : `${open} TODO`;
}

export function formatModeCompact(state: Pick<VisualWorkflowState, "mode" | "phase">): string {
  const phase = WORKFLOW_PHASE_LABEL[state.phase];
  if (state.mode === "simple_plan") return `PLAN:${phase === "PLAN" ? "DRAFT" : phase}`;
  if (state.mode === "detailed_plan") return `ARCH:${phase === "PLAN" ? "DRAFT" : phase}`;
  if (state.phase === "idle" || state.phase === "ready") return phase;
  if (state.phase === "reviewing" || state.phase === "reviewed") return "REVIEW";
  return "WORK";
}

export function formatHeaderLines(_cwd: string, state: VisualWorkflowState): string[] {
  let mainState: string;
  if (state.permissionLevel === "yolo") {
    mainState = "!!! YOLO MODE !!!";
  } else if (state.permissionLevel === "full-access") {
    mainState = "⚠ FULL ACCESS";
  } else if (state.phase === "deciding" || state.phase === "draft") {
    mainState = "PLANUNG AKTIV";
  } else if (state.phase === "reviewing" || state.phase === "reviewed") {
    mainState = "REVIEW";
  } else if (state.phase === "executing") {
    mainState = "WORK AKTIV";
  } else if (state.phase === "ready") {
    mainState = "FERTIG";
  } else {
    mainState = "BEREIT";
  }
  return [`PI · ${mainState}`];
}

export function formatFooterLine(cwd: string, state: VisualWorkflowState, gitBranch?: string | null): string {
  const parts = [
    projectLabel(cwd),
    formatModeCompact(state),
    state.model ?? "no model",
    (state.thinking ?? "-").toUpperCase(),
  ];
  if (gitBranch) parts.push(`git:${gitBranch}`);
  return parts.join(" · ");
}

export function permissionShortLabel(level: PermissionLevel): string {
  switch (level) {
    case "read-only":
      return "READ";
    case "read-bash":
      return "READ+BASH";
    case "read-write":
      return "READ+WRITE";
    case "full-access":
      return "FULL ACCESS";
    case "yolo":
      return "YOLO";
  }
}

export function formatPermissionWarning(level: PermissionLevel): string | undefined {
  if (level === "full-access") {
    return [
      "⚠ FULL ACCESS AKTIV",
      "Der Agent darf schreiben, Paketmanager und Git-Housekeeping ausführen.",
      "Sudo, Löschen, externe Schreibzugriffe und Force-Push bleiben bestätigungspflichtig.",
    ].join("\n");
  }
  if (level === "yolo") {
    return [
      "!!! YOLO MODE !!!",
      "Keine normale Sicherheitsstufe. Viele riskante Aktionen laufen ohne Rückfrage.",
      "Nur harte Warnmuster wie Secrets, Systempfade, .git- und Root-Löschung bleiben bestätigt.",
    ].join("\n");
  }
  return undefined;
}

export function formatEmptyPlanState(): string {
  return [
    "KEIN AKTIVER PLAN",
    "",
    "Nächste sinnvolle Schritte:",
    "1. /plan     Schnell- oder Architekturplan erstellen",
    "2. /decide   Entscheidung klären",
    "3. /actions  Menü öffnen",
  ].join("\n");
}

export function progressSymbol(item: WorkProgressItem): string {
  if (item.failed) return "×";
  if (item.blocked) return "!";
  if (item.completed) return "✓";
  if (item.running) return "…";
  return "○";
}

export function formatWorkProgressLines(items: WorkProgressItem[]): string[] {
  if (items.length === 0) return ["WORK PROGRESS", "Keine Plan-Todos gefunden."];
  return [
    "WORK PROGRESS",
    "",
    ...items.map((item) => `T${item.step} ${progressSymbol(item)} ${item.text}`),
  ];
}
