import { homedir } from "node:os";
import { basename, dirname, normalize } from "node:path";
import type {
  PermissionLevel,
  WorkflowMode,
  WorkflowPhase,
} from "./workflow-status.ts";
import {
  PERMISSION_LEVEL_LABEL,
  WORKFLOW_PHASE_LABEL,
} from "./workflow-status.ts";
import { truncateModelName, truncatePlain } from "./render-profile.ts";

export type VisualTone =
  "neutral" | "plan" | "review" | "work" | "warning" | "danger" | "success";

export interface VisualWorkflowState {
  mode: WorkflowMode;
  phase: WorkflowPhase;
  permissionLevel: PermissionLevel;
  planExists: boolean;
  completedTodos: number;
  totalTodos: number;
  model?: string;
  thinking?: string;
  themeName?: string;
  activeSubagents?: number;
  subagentWarnings?: number;
  subagentErrors?: number;
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

export type FooterSegmentTone = VisualTone | "muted";

export interface FooterSegment {
  id:
    | "mode"
    | "model"
    | "error"
    | "warning"
    | "subagents"
    | "permission"
    | "git"
    | "thinking";
  text: string;
  tone: FooterSegmentTone;
  /** Höhere Werte werden bei Platzmangel früher entfernt. */
  dropPriority: number;
  required?: boolean;
}

export function projectLabel(cwd: string): string {
  const home = normalize(homedir());
  const normalized = normalize(cwd);
  if (normalized === home) return "~";
  if (normalized.startsWith(`${home}/`))
    return `~/${normalized.slice(home.length + 1)}`;
  const parent = basename(dirname(normalized));
  const leaf = basename(normalized);
  return parent && parent !== "." ? `${parent}/${leaf}` : leaf;
}

export function phaseTone(
  phase: WorkflowPhase,
  mode: WorkflowMode,
): VisualTone {
  if (phase === "reviewing" || phase === "reviewed") return "review";
  if (phase === "executing" || phase === "ready") return "work";
  if (phase === "deciding") return "plan";
  if (mode === "simple_plan" || mode === "detailed_plan" || phase === "draft")
    return "plan";
  return "neutral";
}

export function permissionTone(level: PermissionLevel): VisualTone {
  if (level === "yolo") return "danger";
  if (level === "full-access") return "warning";
  if (level === "read-only" || level === "read-bash") return "review";
  return "neutral";
}

export function toneColor(
  tone: VisualTone,
): "text" | "accent" | "warning" | "error" | "success" | "muted" {
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

export function formatModePhase(
  state: Pick<VisualWorkflowState, "mode" | "phase">,
): string {
  const phase = WORKFLOW_PHASE_LABEL[state.phase];
  if (state.mode === "simple_plan")
    return `PLAN · ${phase === "PLAN" ? "DRAFT" : phase}`;
  if (state.mode === "detailed_plan")
    return `ARCH · ${phase === "PLAN" ? "DRAFT" : phase}`;
  // Work mode: show phase only for idle/ready, otherwise just "WORK"
  if (state.phase === "idle" || state.phase === "ready") return phase;
  return "WORK";
}

export function formatTodoSummary(completed: number, total: number): string {
  if (total <= 0) return "NO TODO";
  const open = Math.max(0, total - completed);
  return open === 0 ? `${total} TODO ✓` : `${open} TODO`;
}

export function formatModeCompact(
  state: Pick<VisualWorkflowState, "mode" | "phase">,
): string {
  const phase = WORKFLOW_PHASE_LABEL[state.phase];
  if (state.mode === "simple_plan")
    return `PLAN:${phase === "PLAN" ? "DRAFT" : phase}`;
  if (state.mode === "detailed_plan")
    return `ARCH:${phase === "PLAN" ? "DRAFT" : phase}`;
  if (state.phase === "idle" || state.phase === "ready") return phase;
  if (state.phase === "reviewing" || state.phase === "reviewed")
    return "REVIEW";
  return "WORK";
}

export function formatHeaderLines(
  _cwd: string,
  _state: VisualWorkflowState,
): string[] {
  return ["Pi Agent"];
}

export function formatFooterLine(
  _cwd: string,
  state: VisualWorkflowState,
  gitBranch?: string | null,
): string {
  return buildFooterSegments(state, gitBranch, false)
    .map((segment) => segment.text)
    .join(" · ");
}

export function formatFooterLineCompact(
  _cwd: string,
  state: VisualWorkflowState,
  gitBranch?: string | null,
): string {
  return buildFooterSegments(state, gitBranch, true)
    .map((segment) => segment.text)
    .join(" · ");
}

/** Priorisierte, semantisch färbbare Footersegmente. */
export function buildFooterSegments(
  state: VisualWorkflowState,
  gitBranch?: string | null,
  compact = false,
): FooterSegment[] {
  const segments: FooterSegment[] = [
    {
      id: "mode",
      text: compact
        ? formatModeCompact(state)
        : `MODUS:${formatModeCompact(state)}`,
      tone: phaseTone(state.phase, state.mode),
      dropPriority: 0,
      required: true,
    },
    {
      id: "model",
      text: compact
        ? truncateModelName(state.model, 18)
        : `MODELL:${truncateModelName(state.model, 30)}`,
      tone: "muted",
      dropPriority: 10,
      required: true,
    },
  ];

  if ((state.subagentErrors ?? 0) > 0) {
    segments.push({
      id: "error",
      text: `${compact ? "ERR" : "FEHLER"}:${state.subagentErrors}`,
      tone: "danger",
      dropPriority: 0,
      required: true,
    });
  }
  if ((state.subagentWarnings ?? 0) > 0) {
    segments.push({
      id: "warning",
      text: `${compact ? "WARN" : "WARNUNG"}:${state.subagentWarnings}`,
      tone: "warning",
      dropPriority: 1,
      required: true,
    });
  }
  if ((state.activeSubagents ?? 0) > 0) {
    segments.push({
      id: "subagents",
      text: `SA:${state.activeSubagents}`,
      tone: "work",
      dropPriority: 5,
      required: true,
    });
  }

  segments.push({
    id: "permission",
    text: `${compact ? "R" : "RECHTE"}:${permissionShortLabel(state.permissionLevel)}`,
    tone: permissionTone(state.permissionLevel),
    dropPriority: 40,
  });
  if (gitBranch) {
    segments.push({
      id: "git",
      text: `${compact ? "G" : "GIT"}:${truncatePlain(gitBranch, compact ? 12 : 24)}`,
      tone: "muted",
      dropPriority: 60,
    });
  }
  segments.push({
    id: "thinking",
    text: `${compact ? "D" : "DENKEN"}:${(state.thinking ?? "-").toUpperCase()}`,
    tone: "muted",
    dropPriority: 70,
  });
  return segments;
}

/** Entfernt nur optionale Segmente, bis die Zeile in die Terminalbreite passt. */
export function fitFooterSegments(
  segments: FooterSegment[],
  width: number,
): FooterSegment[] {
  const result = segments.map((segment) => ({ ...segment }));
  const renderedWidth = () =>
    result.reduce((sum, segment) => sum + segment.text.length, 0) +
    Math.max(0, result.length - 1) * 3;

  while (renderedWidth() > width) {
    let candidate = -1;
    for (let index = 0; index < result.length; index += 1) {
      if (result[index]!.required) continue;
      if (
        candidate < 0 ||
        result[index]!.dropPriority > result[candidate]!.dropPriority
      ) {
        candidate = index;
      }
    }
    if (candidate < 0) break;
    result.splice(candidate, 1);
  }

  if (renderedWidth() > width && result.length > 0) {
    const overflow = renderedWidth() - width;
    const model = result.find((segment) => segment.id === "model");
    const target = model ?? result[result.length - 1]!;
    target.text = truncatePlain(
      target.text,
      Math.max(3, target.text.length - overflow),
    );
  }
  return result;
}

export function permissionShortLabel(level: PermissionLevel): string {
  switch (level) {
    case "read-only":
      return "READ";
    case "read-bash":
      return "READ+BASH";
    case "test-bash":
      return "TEST";
    case "read-write":
      return "READ+WRITE";
    case "full-access":
      return "FULL ACCESS";
    case "yolo":
      return "YOLO";
  }
}

export function formatPermissionWarning(
  level: PermissionLevel,
): string | undefined {
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

export type RiskLevel = "low" | "medium" | "high";

export function riskTone(risk: RiskLevel): VisualTone {
  if (risk === "high") return "danger";
  if (risk === "medium") return "warning";
  return "neutral";
}

export function riskLabel(risk: RiskLevel): string {
  return { low: "niedrig", medium: "mittel", high: "hoch" }[risk];
}

/**
 * Grobe Risikoableitung aus einer PolicyDecision, ohne deren Form anzufassen
 * (permission-policy.ts bleibt unverändert; die ~40 bestehenden
 * decideBash/decideFileAccess-Tests prüfen nur `.action`).
 */
export function decisionRisk(decision: {
  action: string;
  hard?: boolean;
}): RiskLevel {
  if (decision.action === "block") return "high";
  return decision.hard ? "high" : "medium";
}

/**
 * Färbt eine Zeilenliste einheitlich ein: erste Zeile fett+accent als Titel,
 * weitere Zeilen per Callback getönt. Der Aufrufer leitet die Tonalität aus
 * seinen eigenen strukturierten Daten ab (z. B. Status-Feldern), statt den
 * bereits gerenderten Text nach Glyphen zu durchsuchen — löst die bisherige
 * Duplikation zwischen subagents/index.ts und plan-mode/index.ts.
 */
export function colorizeStatusLines(
  lines: string[],
  theme: {
    fg(color: string, text: string): string;
    bold(text: string): string;
  },
  lineTone?: (line: string, index: number) => VisualTone | "muted" | undefined,
): string[] {
  return lines.map((line, index) => {
    if (index === 0) return theme.fg("accent", theme.bold(line));
    const tone = lineTone?.(line, index);
    if (tone === "muted") return theme.fg("muted", line);
    if (tone) return theme.fg(toneColor(tone), line);
    return theme.fg("text", line);
  });
}

export function progressSymbol(item: WorkProgressItem): string {
  if (item.failed) return "×";
  if (item.blocked) return "!";
  if (item.completed) return "✓";
  if (item.running) return "…";
  return "○";
}

export function formatWorkProgressLines(items: WorkProgressItem[]): string[] {
  if (items.length === 0)
    return ["WORK PROGRESS", "Keine Plan-Todos gefunden."];
  return [
    "WORK PROGRESS",
    "",
    ...items.map(
      (item) => `T${item.step} ${progressSymbol(item)} ${item.text}`,
    ),
  ];
}

/** Kompakte Widgetansicht; /plan-todos behält weiterhin die vollständige Liste. */
export function formatWorkProgressWidgetLines(
  items: WorkProgressItem[],
): string[] {
  if (items.length === 0) return ["Keine Plan-Todos gefunden."];

  const currentIndex = items.findIndex((item) => item.running);
  const firstOpenIndex = items.findIndex((item) => !item.completed);
  const activeIndex = currentIndex >= 0 ? currentIndex : firstOpenIndex;
  let lastCompletedIndex = -1;
  for (let index = 0; index < items.length; index += 1) {
    if (items[index]!.completed) lastCompletedIndex = index;
  }
  const nextIndex =
    activeIndex >= 0
      ? items.findIndex(
          (item, index) => index > activeIndex && !item.completed,
        )
      : -1;

  const indexes = [lastCompletedIndex, activeIndex, nextIndex]
    .filter((index, position, values) =>
      index >= 0 && values.indexOf(index) === position,
    )
    .sort((a, b) => a - b);
  if (indexes.length === 0) indexes.push(Math.max(0, items.length - 1));

  const lines = indexes.map((index) => {
    const item = items[index]!;
    return `T${item.step} ${progressSymbol(item)} ${item.text}`;
  });
  const omitted = items.length - indexes.length;
  if (omitted > 0) lines.push(`+ ${omitted} weitere`);
  return lines;
}
