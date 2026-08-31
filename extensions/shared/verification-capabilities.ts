/**
 * Synchronous capability bridge for verifier coverage.
 *
 * Same pattern as workflow-capabilities.ts/recovery-capabilities.ts: the
 * permission layer asks, setup-core (which already tracks verifier run
 * records via subagent-output-guard.ts and binds them to a workspace
 * fingerprint) answers during event dispatch. The permission layer holds no
 * verifier state of its own and no second persistence source.
 */

export const VERIFICATION_CAPABILITY_EVENTS = {
  request: "verification-capabilities:request",
} as const;

const VERIFIER_STATUSES = ["completed", "incomplete"] as const;
export type VerifierRunStatusSnapshot = (typeof VERIFIER_STATUSES)[number];

const VERIFIER_VERDICTS = [
  "PASS",
  "PASS_WITH_WARNINGS",
  "FAIL",
  "UNVERIFIABLE",
] as const;
export type VerifierVerdictSnapshot = (typeof VERIFIER_VERDICTS)[number];

export interface VerificationCapabilitySnapshot {
  /** Workspace the last recorded verifier run judged; absent if none yet. */
  workspaceRoot?: string;
  /** Workspace fingerprint at the moment that run's result was recorded. */
  workspaceFingerprint?: string;
  verifierStatus?: VerifierRunStatusSnapshot;
  /** Only ever set when verifierStatus is "completed". */
  verifierVerdict?: VerifierVerdictSnapshot;
}

export interface VerificationCapabilityRequest {
  respond(snapshot: VerificationCapabilitySnapshot): void;
}

export interface VerificationEventBus {
  emit(channel: string, value: unknown): void;
}

const DEFAULT_SNAPSHOT: VerificationCapabilitySnapshot = {};

export function requestVerificationCapabilities(
  events: VerificationEventBus,
): VerificationCapabilitySnapshot {
  let snapshot: VerificationCapabilitySnapshot | undefined;
  events.emit(VERIFICATION_CAPABILITY_EVENTS.request, {
    respond(value: VerificationCapabilitySnapshot) {
      if (!snapshot && isVerificationCapabilitySnapshot(value)) {
        snapshot = value;
      }
    },
  } satisfies VerificationCapabilityRequest);
  return snapshot ?? DEFAULT_SNAPSHOT;
}

export function isVerificationCapabilitySnapshot(
  value: unknown,
): value is VerificationCapabilitySnapshot {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  if (
    candidate.workspaceRoot !== undefined &&
    typeof candidate.workspaceRoot !== "string"
  ) {
    return false;
  }
  if (
    candidate.workspaceFingerprint !== undefined &&
    typeof candidate.workspaceFingerprint !== "string"
  ) {
    return false;
  }
  if (
    candidate.verifierStatus !== undefined &&
    !VERIFIER_STATUSES.includes(
      candidate.verifierStatus as VerifierRunStatusSnapshot,
    )
  ) {
    return false;
  }
  if (
    candidate.verifierVerdict !== undefined &&
    !VERIFIER_VERDICTS.includes(
      candidate.verifierVerdict as VerifierVerdictSnapshot,
    )
  ) {
    return false;
  }
  return true;
}
