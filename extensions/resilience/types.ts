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
  provider: string;
  model: string;
  contextPercent: number | null;
}

/**
 * `completed_after_failure` ist ein Turn, der nach mindestens einem
 * beobachteten Fehler durch Pis natives Retry doch noch erfolgreich
 * siedelte.
 */
export interface TurnSettledMarker {
  schemaVersion: 1 | 2;
  timestamp: string;
  turnStartedAt: string;
  outcome: "completed" | "completed_after_failure" | "failed" | "aborted";
  observedFailureCount: number;
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
  activeSubagents: number;
  settled: false;
}

export interface CompactionBoundaryMarker {
  schemaVersion: 1 | 2;
  timestamp: string;
  boundary: "started" | "completed" | "failed";
  reason: "manual" | "threshold" | "overflow";
  willRetry: boolean;
  contextPercent: number | null;
  errorMessage?: string;
}

/**
 * Der Lauf davor endete, bevor das Modell die Wirkung seiner mutierenden
 * Aufrufe bestätigen konnte; der nächste Lauf bekam einen Hinweis darauf.
 */
export interface InterruptionNoticeMarker {
  schemaVersion: 1 | 2;
  timestamp: string;
  reason: "error" | "aborted" | "no-result" | "no-follow-up";
  /** Session-Eintrag, an dem der unterbrochene Lauf endete. */
  entryId: string;
  mutatingCalls: number;
  /** Mutierende Aufrufe ohne Tool-Ergebnis (Ausgang unbekannt). */
  unconfirmedCalls: number;
}

/** Maximale Länge des gespeicherten Fehlertexts in FailureDiagnostic. */
export const ERROR_MESSAGE_MAX = 500 as const;

export interface OpenTurn {
  marker: TurnStartMarker;
  phase: TurnPhase;
  activeSubagents: number;
  observedFailureCount: number;
  currentAttemptFailed: boolean;
  currentAttemptAborted: boolean;
}
