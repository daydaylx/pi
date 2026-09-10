/**
 * Synchronous capability bridge for the resilience recovery gate.
 *
 * Same pattern as workflow-capabilities.ts: the permission layer asks, the
 * resilience extension answers during event dispatch. Die Guard-Schicht hält
 * damit keinen eigenen Recovery-Zustand und keine zweite Persistenzquelle —
 * die Wahrheit bleibt bei den Session-Einträgen der Resilience-Extension.
 */

export const RECOVERY_CAPABILITY_EVENTS = {
  request: "recovery-status:request",
} as const;

export interface RecoveryStatusSnapshot {
  /** true, solange Schreibzugriffe wegen eines offenen Gates blockiert sind. */
  armed: boolean;
  /** Der Turn, dessen Recovery noch offen ist — für Blocktexte und Status. */
  turnStartedAt?: string;
  /** Warum das Gate scharf ist. */
  reason?: "interrupted" | "final_failure" | "workspace-changed";
}

export interface RecoveryStatusRequest {
  respond(
    snapshot: RecoveryStatusSnapshot | Promise<RecoveryStatusSnapshot>,
  ): void;
}

export interface RecoveryEventBus {
  emit(channel: string, value: unknown): void;
}

const DEFAULT_SNAPSHOT: RecoveryStatusSnapshot = { armed: false };

export async function requestRecoveryStatus(
  events: RecoveryEventBus,
): Promise<RecoveryStatusSnapshot> {
  let pending:
    RecoveryStatusSnapshot | Promise<RecoveryStatusSnapshot> | undefined;
  events.emit(RECOVERY_CAPABILITY_EVENTS.request, {
    respond(value: RecoveryStatusSnapshot | Promise<RecoveryStatusSnapshot>) {
      if (pending === undefined) pending = value;
    },
  } satisfies RecoveryStatusRequest);
  if (pending === undefined) return DEFAULT_SNAPSHOT;
  const resolved = await pending;
  return isRecoveryStatusSnapshot(resolved) ? resolved : DEFAULT_SNAPSHOT;
}

export function isRecoveryStatusSnapshot(
  value: unknown,
): value is RecoveryStatusSnapshot {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { armed?: unknown };
  return typeof candidate.armed === "boolean";
}
