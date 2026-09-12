import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { crop } from "./layout.ts";
import type { AuroraUiState } from "./state.ts";
import { renderField, renderPill, renderTile, statusFill } from "./tile.ts";
import type { TaskViewModel } from "./task-view-model.ts";

/** Presentation input derived from the real runtime activity state. */
export type HeaderActivity =
  "idle" | "thinking" | "running" | "responding" | "waiting" | "done" | "error";

export type SessionPanelMode = "auto" | "compact" | "expanded" | "hidden";

type SessionStatus =
  | "idle"
  | "thinking"
  | "responding"
  | "working"
  | "waiting"
  | "verified"
  | "completed"
  | "error";

type SessionTask = Pick<
  TaskViewModel,
  | "title"
  | "goal"
  | "phase"
  | "currentWork"
  | "subagents"
  | "verification"
  | "changesSummary"
>;

export interface SessionPanelInput {
  state: AuroraUiState;
  task?: SessionTask;
  activity: HeaderActivity;
  elapsedSeconds?: number;
  mode?: SessionPanelMode;
  rows?: number;
  /** Explicitly used by the existing compact dashboard mode. */
  collapsed?: boolean;
}

function workflowLabel(state: AuroraUiState): string {
  const label = state.workflow.label?.trim();
  if (label) return label.toUpperCase();
  return state.workflow.phase.replace(/_/g, " ").toUpperCase();
}

/** The status is a projection, never a second persisted workflow state. */
export function sessionStatus(input: SessionPanelInput): SessionStatus {
  if (input.activity === "error") return "error";
  const activeTurn = ["thinking", "responding", "running", "waiting"].includes(
    input.activity,
  );
  // A previous failed check is a session risk, but it must not hide current
  // work. The task projection uses the same precedence: active work remains
  // active until the turn is actually idle or settled.
  if (!activeTurn && input.task?.verification?.verdict === "NOT_READY") {
    return "error";
  }

  switch (input.activity) {
    case "thinking":
      return "thinking";
    case "responding":
      return "responding";
    case "running":
      return "working";
    case "waiting":
      return "waiting";
    case "done":
      return input.task?.verification?.verdict === "READY"
        ? "verified"
        : "completed";
    case "idle":
      if (input.task?.verification?.verdict === "READY") return "verified";
      if (input.task?.phase === "done") return "completed";
      return "idle";
  }
}

function statusLabel(status: SessionStatus): string {
  switch (status) {
    case "thinking":
      return "DENKT NACH";
    case "responding":
      return "ANTWORTET";
    case "working":
      return "ARBEITET";
    case "waiting":
      return "WARTET";
    case "verified":
      return "VERIFIZIERT";
    case "completed":
      return "ABGESCHLOSSEN";
    case "error":
      return "FEHLER";
    default:
      return "IDLE";
  }
}

function statusTone(
  status: SessionStatus,
): "muted" | "accent" | "success" | "error" {
  if (status === "error") return "error";
  if (status === "verified" || status === "completed") return "success";
  if (status === "idle" || status === "waiting") return "muted";
  return "accent";
}

function statusGlyph(status: SessionStatus): string {
  if (status === "error") return "✕";
  if (status === "verified" || status === "completed") return "✓";
  if (status === "idle" || status === "waiting") return "○";
  return "●";
}

function formatElapsed(seconds: number): string {
  const elapsed = Math.max(0, Math.floor(seconds));
  if (elapsed < 60) return `${elapsed}s`;
  const minutes = Math.floor(elapsed / 60);
  const remainder = elapsed % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function renderStatusLine(
  theme: Theme,
  status: SessionStatus,
  elapsedSeconds?: number,
): string {
  const elapsed =
    elapsedSeconds !== undefined && status !== "idle"
      ? ` · ${formatElapsed(elapsedSeconds)}`
      : "";
  return renderPill(
    theme,
    `${statusGlyph(status)} ${statusLabel(status)}${elapsed}`,
    statusTone(status),
  );
}

function branchStatusLabel(
  status: TaskViewModel["subagents"][number]["status"],
): string {
  switch (status) {
    case "running":
      return "aktiv";
    case "queued":
      return "wartet";
    case "paused":
      return "pausiert";
    case "needs_attention":
      return "Aufmerksamkeit";
    default:
      return status;
  }
}

function sessionDetails(
  task: SessionTask | undefined,
  theme: Theme,
  expanded: boolean,
): string[] {
  if (!task) return [];
  const lines: string[] = [];
  const subagents = task.subagents ?? [];
  if (subagents.length > 0) {
    const running = subagents.filter(
      (entry) => entry.status === "running",
    ).length;
    const waiting = subagents.filter(
      (entry) => entry.status === "queued",
    ).length;
    const attention = subagents.filter(
      (entry) => entry.status === "needs_attention",
    ).length;
    const summary = [
      running > 0 ? `${running} aktiv` : "",
      waiting > 0 ? `${waiting} wartet` : "",
      attention > 0 ? `${attention} Aufmerksamkeit` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    if (summary) lines.push(renderField(theme, "Subagenten", summary));

    const verifier = subagents.find((entry) =>
      `${entry.agent} ${entry.role ?? ""}`.toLowerCase().includes("verifier"),
    );
    if (verifier) {
      lines.push(
        renderField(theme, "Verifier", branchStatusLabel(verifier.status)),
      );
    }
  }

  const verification = task.verification;
  if (
    verification?.testsPassed !== undefined &&
    verification.testsTotal !== undefined
  ) {
    lines.push(
      renderField(
        theme,
        "Tests",
        `${verification.testsPassed}/${verification.testsTotal}`,
      ),
    );
  }

  const changes = task.changesSummary;
  if (changes && changes.filesCount > 0) {
    lines.push(
      renderField(
        theme,
        "Änderungen",
        `${changes.filesCount} · +${changes.linesAdded} −${changes.linesRemoved}`,
      ),
    );
  }

  if (verification?.verdict === "NOT_READY" && verification.blockers[0]) {
    lines.push(renderField(theme, "Grund", verification.blockers[0]!));
  }

  if (expanded) {
    if (task.goal) lines.push(renderField(theme, "Ziel", task.goal));
    if (task.currentWork?.summary) {
      lines.push(
        renderField(theme, "Aktuelle Arbeit", task.currentWork.summary),
      );
    }
  }
  return lines;
}

function bodyLimit(input: SessionPanelInput, expanded: boolean): number {
  const rows = input.rows ?? 24;
  if (expanded) return Math.max(2, Math.min(6, rows - 8));
  return Math.max(2, Math.min(4, rows - 8));
}

/**
 * The fixed Session panel. It reuses the current tile shell, but its content
 * comes from the shared task projection and the runtime activity presentation.
 * No state is stored here and no header/workspace/footer value is recomputed
 * from rendered strings.
 */
export function renderHeaderLines(
  theme: Theme,
  width: number,
  input: SessionPanelInput,
): string[] {
  const available = Math.max(1, width);
  const mode = input.mode ?? "auto";
  const status = sessionStatus(input);
  const panelTone = statusTone(status);
  const statusLine = renderStatusLine(theme, status, input.elapsedSeconds);
  const taskTitle =
    input.task?.title ?? input.state.task?.title ?? "Aktuelle Aufgabe";
  const collapsed =
    input.collapsed === true || mode === "compact" || (input.rows ?? 24) <= 10;

  if (collapsed) {
    return renderTile(theme, available, {
      title: `Sitzung · ${workflowLabel(input.state)}`,
      badge: `${statusGlyph(status)} ${statusLabel(status)}${
        input.elapsedSeconds !== undefined && status !== "idle"
          ? ` · ${formatElapsed(input.elapsedSeconds)}`
          : ""
      }`,
      tone: panelTone,
      fill: statusFill(panelTone),
      lines: [],
    });
  }

  const bodyWidth = Math.max(1, available - 4);
  const taskLine = theme.fg("text", taskTitle);
  const statusWidth = visibleWidth(statusLine);
  const inlineGap = 2;
  const body: string[] = [];
  if (visibleWidth(taskLine) + inlineGap + statusWidth <= bodyWidth) {
    body.push(`${taskLine}${" ".repeat(inlineGap)}${statusLine}`);
  } else {
    body.push(crop(taskLine, bodyWidth), crop(statusLine, bodyWidth));
  }

  const expanded = mode === "expanded";
  body.push(
    ...sessionDetails(input.task, theme, expanded).slice(
      0,
      Math.max(0, bodyLimit(input, expanded) - body.length),
    ),
  );

  return renderTile(theme, available, {
    title: "Sitzung",
    badge: workflowLabel(input.state),
    tone: panelTone,
    fill: statusFill(panelTone),
    lines: body,
  });
}
