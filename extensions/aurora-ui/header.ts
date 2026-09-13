import type { TaskViewModel } from "./task-view-model.ts";

/** Presentation input derived from the real runtime activity state. */
export type HeaderActivity =
  "idle" | "thinking" | "running" | "responding" | "waiting" | "done" | "error";

export type SessionStatus =
  | "idle"
  | "thinking"
  | "responding"
  | "working"
  | "waiting"
  | "verified"
  | "completed"
  | "error";

export type SessionTask = Pick<TaskViewModel, "phase" | "verification">;

export interface SessionStatusInput {
  activity: HeaderActivity;
  task?: SessionTask;
}

/** The status is a projection, never a second persisted workflow state. */
export function sessionStatus(input: SessionStatusInput): SessionStatus {
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

export function statusLabel(status: SessionStatus): string {
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

export function statusTone(
  status: SessionStatus,
): "muted" | "accent" | "success" | "error" {
  if (status === "error") return "error";
  if (status === "verified" || status === "completed") return "success";
  if (status === "idle" || status === "waiting") return "muted";
  return "accent";
}
