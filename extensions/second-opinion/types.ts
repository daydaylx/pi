import type { Model } from "@earendil-works/pi-ai";

export const REASON_CATEGORIES = [
  "ARCHITECTURE_FORK",
  "UNCERTAIN_ASSUMPTION",
  "FAILED_ATTEMPT",
  "CONFLICTING_EVIDENCE",
  "COMPLEXITY_REDUCTION",
] as const;
export type ReasonCategory = (typeof REASON_CATEGORIES)[number];

export const OPINION_STATUSES = [
  "completed",
  "insufficient_context",
  "blocked_sensitive_content",
  "context_budget_exceeded",
  "denied",
  "cancelled",
  "timeout",
  "unavailable",
  "provider_error",
  "invalid_response",
  "stale_context",
] as const;
export type OpinionStatus = (typeof OPINION_STATUSES)[number];

export interface ContextReference {
  kind: "code_range" | "diff" | "test_summary" | "requirement";
  path?: string;
  startLine?: number;
  endLine?: number;
  label: string;
}

export interface OpinionRequest {
  requestId: string;
  decisionId: string;
  triggerSource: "main_agent";
  question: string;
  reason: string;
  expectedBenefit: string;
  reasonCategory: ReasonCategory;
  constraints: string[];
  options?: string[];
  contextRefs: ContextReference[];
}

export interface ContextManifestEntry {
  path: string;
  range: string;
  contentType: ContextReference["kind"];
  bytes: number;
  estimatedTokens: number;
  snapshotHash: string;
  content: string;
}

export interface ContextManifest {
  references: ContextReference[];
  entries: ContextManifestEntry[];
  bytes: number;
  estimatedTokens: number;
  snapshotHash: string;
}

export interface ApprovalSnapshot {
  approvalId: string;
  request: OpinionRequest;
  manifest: ContextManifest;
  model: Pick<Model<any>, "provider" | "id" | "api">;
  modelDisplayId: string;
  mainModelProvider?: string;
  backendRelation:
    "different_backend_preferred" | "same_backend_allowed" | "unknown";
  estimatedInputTokens: number;
  createdAt: number;
}

export interface OpinionCompleted {
  status: "completed";
  assessment: string;
  mainReason: string;
  mainRisk: string;
  strongestCounterargument: string;
  missingEvidence: string[];
  confidence: "low" | "medium" | "high";
}

export interface OpinionResult {
  status: OpinionStatus;
  requestId: string;
  decisionId: string;
  result?: OpinionCompleted;
  message?: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
}

export interface OpinionTelemetry {
  eventName: "second_opinion";
  requestId: string;
  decisionId: string;
  triggerSource: "main_agent";
  reasonCategory: ReasonCategory;
  mainModelFamily: string;
  opinionModelId: string;
  gatewayId: string;
  status: OpinionStatus;
  approved: "yes" | "no";
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
  contextRefCount: number;
}

export interface OpinionModel {
  model: Model<any>;
  displayId: string;
}
