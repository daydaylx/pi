/**
 * The turn's own outcome, kept deliberately separate from workspace
 * verification: a previous successful check answers "is this workspace
 * technically proven?", never "did the current turn succeed?".
 *
 * `agent_end` fires once per individual agent loop; Pi can retry, compact, or
 * queue another loop after it, and each of those re-enters via `agent_start`.
 * Only `agent_settled` is the real turn boundary, so this reducer always
 * reflects the *last* agent_end's outcome by the time a caller reads it after
 * settle — never a stale mid-turn error that a later retry already resolved.
 *
 * A tool failure alone never reaches this reducer: it is a live-activity
 * event (still visible via the tool row's own error tone), not a turn
 * outcome. Only the agent run's own reported stop reason decides succeeded
 * vs. failed vs. cancelled.
 */
export type TurnStatus =
  "none" | "running" | "succeeded" | "failed" | "cancelled";

export interface TurnLifecycleState {
  status: TurnStatus;
}

export function initialTurnLifecycle(): TurnLifecycleState {
  return { status: "none" };
}

export function turnLifecycleOnAgentStart(): TurnLifecycleState {
  return { status: "running" };
}

interface AssistantStopLike {
  role?: unknown;
  stopReason?: unknown;
  errorMessage?: unknown;
}

/** Scans backwards for the last assistant message, matching the pattern
 * `resilience/index.ts`'s `lastAssistantError()` already uses for the same
 * SDK event. */
export function lastAssistantStop(
  messages: readonly AssistantStopLike[] | undefined,
): { stopReason?: string; errorMessage?: string } {
  if (!messages) return {};
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== "assistant") continue;
    return {
      stopReason:
        typeof message.stopReason === "string" ? message.stopReason : undefined,
      errorMessage:
        typeof message.errorMessage === "string"
          ? message.errorMessage
          : undefined,
    };
  }
  return {};
}

export function turnLifecycleOnAgentEnd(
  state: TurnLifecycleState,
  stopReason: string | undefined,
): TurnLifecycleState {
  if (stopReason === "error") return { status: "failed" };
  if (stopReason === "aborted") return { status: "cancelled" };
  if (stopReason) return { status: "succeeded" };
  return state;
}

/** The sole terminal boundary. Falls back to "succeeded" only if no
 * agent_end ever reported a concrete outcome — a defensive floor, not the
 * normal path. */
export function turnLifecycleOnSettled(
  state: TurnLifecycleState,
): TurnLifecycleState {
  if (state.status === "running" || state.status === "none") {
    return { status: "succeeded" };
  }
  return state;
}
