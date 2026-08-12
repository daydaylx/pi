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
  schemaVersion: 1;
  timestamp: string;
  workspaceFingerprint: string;
  workflowMode: string;
  provider: string;
  model: string;
  contextPercent: number | null;
}

export interface TurnSettledMarker {
  schemaVersion: 1;
  timestamp: string;
  turnStartedAt: string;
  workspaceFingerprint: string;
  outcome: "completed" | "failed";
  observedFailureCount: number;
}

export interface FailureDiagnostic {
  schemaVersion: 1;
  timestamp: string;
  provider: string;
  model: string;
  contextPercent: number | null;
  errorClass: ErrorClass;
  errorCode?: string;
  phase: TurnPhase;
  workspaceChangedSinceTurnStart: boolean;
  toolMayHaveMutatedWorkspace: boolean;
  activeSubagents: number;
  settled: false;
}

export interface CompactionBoundaryMarker {
  schemaVersion: 1;
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
  schemaVersion: 1;
  timestamp: string;
  turnStartedAt: string;
  reason: "interrupted" | "final_failure";
  workspaceChangedSinceTurnStart: boolean;
  toolMayHaveMutatedWorkspace: boolean;
}

export interface OpenTurn {
  marker: TurnStartMarker;
  phase: TurnPhase;
  activeSubagents: number;
  toolMayHaveMutatedWorkspace: boolean;
  observedFailureCount: number;
  currentAttemptFailed: boolean;
}
