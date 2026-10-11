export type TurnPhase =
  | "before_first_token"
  | "streaming_text"
  | "streaming_tool_call"
  | "tool_running"
  | "post_tool"
  | "compaction";

export type ErrorClass =
  "network" | "http" | "auth" | "timeout" | "stream" | "unknown";

export interface TurnStartMarker {
  schemaVersion: 1 | 2;
  timestamp: string;
  workspaceFingerprint: string;
  workspaceRoot?: string;
  /** Start fingerprint for every approved project root at turn start. */
  workspaceFingerprintsByRoot?: Record<string, string>;
  workflowMode: string;
  provider: string;
  model: string;
  contextPercent: number | null;
}

/**
 * `completed_after_failure` ist ein Turn, der nach mindestens einem
 * beobachteten Fehler durch Pis natives Retry doch noch erfolgreich
 * siedelte. `recoveryPending` markiert Turns, unmittelbar nach denen ein
 * `resilience.recovery-required`-Eintrag geschrieben wurde, auch wenn ein
 * Abbruch einen freigegebenen mutierenden Aufruf unterbrochen hat. Beide
 * Felder sind additiv; Leser müssen schemaVersion 1 (ohne sie) akzeptieren.
 */
export interface TurnSettledMarker {
  schemaVersion: 1 | 2;
  timestamp: string;
  turnStartedAt: string;
  workspaceFingerprint: string;
  outcome: "completed" | "completed_after_failure" | "failed" | "aborted";
  observedFailureCount: number;
  recoveryPending?: boolean;
}

export interface FailureDiagnostic {
  schemaVersion: 1 | 2;
  timestamp: string;
  provider: string;
  model: string;
  contextPercent: number | null;
  errorClass: ErrorClass;
  errorCode?: string;
  /** Konkreter Provider-/Stream-Fehlertext, auf ERROR_MESSAGE_MAX gekürzt. */
  errorMessage?: string;
  phase: TurnPhase;
  workspaceChangedSinceTurnStart: boolean;
  toolMayHaveMutatedWorkspace: boolean;
  activeSubagents: number;
  settled: false;
}

export interface CompactionBoundaryMarker {
  schemaVersion: 1 | 2;
  timestamp: string;
  boundary: "started" | "completed" | "failed";
  reason: "manual" | "threshold" | "overflow";
  willRetry: boolean;
  workspaceFingerprint: string;
  workflowMode: string;
  contextPercent: number | null;
  errorMessage?: string;
}

export interface RecoveryRequiredMarker {
  schemaVersion: 1 | 2;
  timestamp: string;
  turnStartedAt: string;
  reason: "interrupted" | "final_failure";
  workspaceChangedSinceTurnStart: boolean;
  toolMayHaveMutatedWorkspace: boolean;
  /** Canonical workspace affected by this marker; absent on legacy global markers. */
  workspaceRoot?: string;
  /** Root-specific evidence for one failed turn. */
  affectedRoots?: Array<{
    workspaceRoot: string;
    workspaceChangedSinceTurnStart: boolean;
    toolMayHaveMutatedWorkspace: boolean;
  }>;
}

/**
 * Abschluss des Recovery-Gates: Der Workspace wurde nach einem
 * `recovery-required` geprüft. Ein erfolgreicher Marker schließt genau dieses
 * Gate dauerhaft; ein neuer Fehlturn oder eine neue Unterbrechung erzeugt ein
 * neues `recovery-required`-Gate.
 */
export interface RecoveryCheckedMarker {
  schemaVersion: 1 | 2;
  timestamp: string;
  turnStartedAt: string;
  workspaceFingerprint: string;
  /** Root inspected by this check; absent on legacy global checks. */
  workspaceRoot?: string;
}

/** Maximale Länge des gespeicherten Fehlertexts in FailureDiagnostic. */
export const ERROR_MESSAGE_MAX = 500 as const;

export interface OpenTurn {
  marker: TurnStartMarker;
  phase: TurnPhase;
  activeSubagents: number;
  toolMayHaveMutatedWorkspace: boolean;
  mutatingWorkspaceRoots: Set<string>;
  observedFailureCount: number;
  currentAttemptFailed: boolean;
  currentAttemptAborted: boolean;
  currentAttemptAbortNeedsRecovery: boolean;
  activeMutatingToolCalls: Set<string>;
}
