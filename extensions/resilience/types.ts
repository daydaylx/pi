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
  workflowMode: string;
  provider: string;
  model: string;
  contextPercent: number | null;
}

/**
 * `completed_after_failure` ist ein Turn, der nach mindestens einem
 * beobachteten Fehler durch Pis natives Retry doch noch erfolgreich
 * siedelte. `recoveryPending` markiert Turns, unmittelbar nach denen ein
 * `resilience.recovery-required`-Eintrag geschrieben wurde. Beide Felder
 * sind additiv; Leser müssen schemaVersion 1 (ohne sie) akzeptieren.
 */
export interface TurnSettledMarker {
  schemaVersion: 1 | 2;
  timestamp: string;
  turnStartedAt: string;
  workspaceFingerprint: string;
  outcome: "completed" | "completed_after_failure" | "failed";
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
}

/**
 * Abschluss des Recovery-Gates: Der Workspace wurde nach einem
 * `recovery-required` geprüft. Der Fingerprint zum Prüfzeitpunkt ist die
 * Freigabebasis — jede spätere Workspace-Änderung macht den Check ungültig.
 */
export interface RecoveryCheckedMarker {
  schemaVersion: 1 | 2;
  timestamp: string;
  turnStartedAt: string;
  workspaceFingerprint: string;
}

/** Maximale Länge des gespeicherten Fehlertexts in FailureDiagnostic. */
export const ERROR_MESSAGE_MAX = 500 as const;

export interface OpenTurn {
  marker: TurnStartMarker;
  phase: TurnPhase;
  activeSubagents: number;
  toolMayHaveMutatedWorkspace: boolean;
  observedFailureCount: number;
  currentAttemptFailed: boolean;
}
