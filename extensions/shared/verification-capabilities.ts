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

const VERIFIER_STATUSES = ["completed", "incomplete", "stale"] as const;
export type VerifierRunStatusSnapshot = (typeof VERIFIER_STATUSES)[number];

const VERIFIER_VERDICTS = [
  "PASS",
  "PASS_WITH_WARNINGS",
  "FAIL",
  "UNVERIFIABLE",
] as const;
export type VerifierVerdictSnapshot = (typeof VERIFIER_VERDICTS)[number];

/**
 * Immutable launch identity for one verifier delegation. The parent tool
 * call's `runId` is the correlation key Aurora can know before the pinned
 * package creates its own child run id. `childRunId` is added only after the
 * package returns a result.
 */
export interface VerificationTicketSnapshot {
  schemaVersion: 1;
  runId: string;
  canonicalRoot: string;
  scope: {
    kind: "workspace";
    canonicalRoot: string;
    changedFiles: string[];
  };
  startFingerprint: string;
  sessionId: string;
  generation: number;
  profile: "verifier";
  effectiveModel: string;
}

export interface VerificationCapabilitySnapshot {
  /** Workspace the last recorded verifier run judged; absent if none yet. */
  workspaceRoot?: string;
  /** Workspace fingerprint at the moment that run's result was recorded. */
  workspaceFingerprint?: string;
  verifierStatus?: VerifierRunStatusSnapshot;
  /** Only ever set when verifierStatus is "completed". */
  verifierVerdict?: VerifierVerdictSnapshot;
  /** The exact launch ticket that authorized this result. */
  ticket?: VerificationTicketSnapshot;
  /** The pinned package's run id, distinct from ticket.runId. */
  childRunId?: string;
  /** Model actually reported by the child result. */
  resultModel?: string;
  /** End fingerprint used to prove the workspace did not mutate in-flight. */
  endFingerprint?: string;
  /** Why a result was made non-evaluable, if applicable. */
  reason?: string;
}

export function hasVerifierTicket(
  snapshot: VerificationCapabilitySnapshot,
): snapshot is VerificationCapabilitySnapshot & {
  ticket: VerificationTicketSnapshot;
} {
  return isVerificationTicketSnapshot(snapshot.ticket);
}

/**
 * Only this stronger predicate is allowed to feed a commit or dedup gate.
 * A ticket without the package child id or without a model match is launch
 * metadata, not completed verification evidence.
 */
export function hasBoundVerifierResult(
  snapshot: VerificationCapabilitySnapshot,
): snapshot is VerificationCapabilitySnapshot & {
  ticket: VerificationTicketSnapshot;
  childRunId: string;
  resultModel: string;
} {
  return (
    hasVerifierTicket(snapshot) &&
    typeof snapshot.childRunId === "string" &&
    snapshot.childRunId.length > 0 &&
    snapshot.childRunId !== snapshot.ticket.runId &&
    typeof snapshot.resultModel === "string" &&
    snapshot.resultModel.length > 0 &&
    snapshot.resultModel === snapshot.ticket.effectiveModel
  );
}

/**
 * A verifier result is evidence only when the run reached a substantive,
 * recognized verdict. A process that exited normally but produced no verdict
 * is not interchangeable with PASS, FAIL, or UNVERIFIABLE: callers must allow
 * it to be retried and it must never satisfy a coverage gate.
 */
export function hasEvaluableVerifierResult(
  snapshot: Pick<
    VerificationCapabilitySnapshot,
    "verifierStatus" | "verifierVerdict"
  >,
): snapshot is VerificationCapabilitySnapshot & {
  verifierStatus: "completed";
  verifierVerdict: VerifierVerdictSnapshot;
} {
  return (
    snapshot.verifierStatus === "completed" &&
    snapshot.verifierVerdict !== undefined
  );
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
  if (
    candidate.ticket !== undefined &&
    !isVerificationTicketSnapshot(candidate.ticket)
  ) {
    return false;
  }
  if (
    candidate.childRunId !== undefined &&
    typeof candidate.childRunId !== "string"
  ) {
    return false;
  }
  if (
    candidate.resultModel !== undefined &&
    typeof candidate.resultModel !== "string"
  ) {
    return false;
  }
  if (
    candidate.endFingerprint !== undefined &&
    typeof candidate.endFingerprint !== "string"
  ) {
    return false;
  }
  if (candidate.reason !== undefined && typeof candidate.reason !== "string") {
    return false;
  }
  return true;
}

function isVerificationTicketSnapshot(
  value: unknown,
): value is VerificationTicketSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const ticket = value as Record<string, unknown>;
  if (
    ticket.schemaVersion !== 1 ||
    typeof ticket.runId !== "string" ||
    ticket.runId.length === 0 ||
    typeof ticket.canonicalRoot !== "string" ||
    ticket.canonicalRoot.length === 0 ||
    typeof ticket.startFingerprint !== "string" ||
    ticket.startFingerprint.length === 0 ||
    typeof ticket.sessionId !== "string" ||
    ticket.sessionId.length === 0 ||
    !Number.isInteger(ticket.generation) ||
    (ticket.generation as number) < 0 ||
    ticket.profile !== "verifier" ||
    typeof ticket.effectiveModel !== "string" ||
    ticket.effectiveModel.length === 0
  ) {
    return false;
  }
  if (!isRecord(ticket.scope)) return false;
  if (
    ticket.scope.kind !== "workspace" ||
    ticket.scope.canonicalRoot !== ticket.canonicalRoot ||
    !Array.isArray(ticket.scope.changedFiles) ||
    !ticket.scope.changedFiles.every(
      (file): file is string => typeof file === "string",
    )
  ) {
    return false;
  }
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
