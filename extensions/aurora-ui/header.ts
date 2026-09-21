import type { TaskViewModel } from "./task-view-model.ts";

/** Presentation input derived from the real runtime activity state. */
export type HeaderActivity =
  | "idle"
  | "thinking"
  | "running"
  | "verifying"
  | "responding"
  | "waiting"
  | "done"
  | "error"
  | "cancelled";

export type SessionStatus =
  | "idle"
  | "thinking"
  | "responding"
  | "working"
  | "verifying"
  | "waiting"
  | "verified"
  | "completed"
  | "error"
  | "cancelled";

export type SessionTask = Pick<TaskViewModel, "phase" | "verification">;

export interface SessionStatusInput {
  activity: HeaderActivity;
  task?: SessionTask;
}

/** The status is a projection, never a second persisted workflow state. */
export function sessionStatus(input: SessionStatusInput): SessionStatus {
  if (input.activity === "error") return "error";
  // A user abort is its own outcome — a stale failed verification from
  // before the abort must not repaint it as a plain "error" below.
  if (input.activity === "cancelled") return "cancelled";
  const activeTurn = [
    "thinking",
    "responding",
    "running",
    "verifying",
    "waiting",
  ].includes(
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
    case "verifying":
      return "verifying";
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

export function statusLabel(status: SessionStatus): string {
  switch (status) {
    case "thinking":
      return "DENKT NACH";
    case "responding":
      return "ANTWORTET";
    case "verifying":
      return "PRÜFT";
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
    case "cancelled":
      return "ABGEBROCHEN";
    default:
      return "BEREIT";
  }
}

export function statusTone(
  status: SessionStatus,
): "muted" | "accent" | "success" | "error" | "thinkingHigh" | "thinkingMax" | "thinkingXhigh" {
  if (status === "error") return "error";
  if (status === "verified" || status === "completed") return "success";
  if (status === "idle" || status === "waiting" || status === "cancelled")
    return "muted";
  if (status === "thinking") return "thinkingHigh";
  if (status === "responding") return "thinkingMax";
  if (status === "verifying") return "thinkingXhigh";
  return "accent";
}
