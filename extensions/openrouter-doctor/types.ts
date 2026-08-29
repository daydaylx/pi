/**
 * Shared types for the OpenRouter Doctor extension.
 *
 * `or`-prefixed types name OpenRouter-specific concepts (model/provider ids
 * as OpenRouter defines them), distinct from Pi's own `Model<Api>` from
 * `@earendil-works/pi-ai`.
 */

/** OpenRouter model id without the `openrouter/` provider prefix, e.g. "openai/gpt-oss-120b". */
export type orModelId = string;

/** OpenRouter upstream provider slug, e.g. "together", "deepinfra", "openai". */
export type orProviderId = string;

export type CheckStatus = "ok" | "warn" | "fail" | "unknown";

export type OverallStatus = "HEALTHY" | "DEGRADED" | "BROKEN";

export type ErrorCategory =
  | "configuration"
  | "authentication"
  | "permission"
  | "model-not-found"
  | "rate-limit"
  | "invalid-request"
  | "gateway"
  | "timeout"
  | "network"
  | "no-endpoints"
  | "tool-calling"
  | "reasoning"
  | "unknown";

/** A normalized, human-explainable view of a raw provider/HTTP error. Never carries secrets. */
export interface NormalizedError {
  category: ErrorCategory;
  httpStatus?: number;
  /** Short German summary of what happened. */
  humanSummary: string;
  /** Possible causes, German, ordered roughly by likelihood. */
  likelyCauses: string[];
  /** A single conservative, non-mutating recommended action, German. */
  recommendedAction: string;
  /** Retry-After value in seconds, when the server provided one (rate-limit/gateway). */
  retryAfterSeconds?: number;
  /** Raw diagnostic fields shown only when --details is passed. Never includes headers/keys. */
  rawDetails?: { status?: number; code?: string; message?: string };
}

/** Input to normalizeError(): what a check observed, before interpretation. */
export type RawCheckError =
  | { kind: "http"; status: number; code?: string; message?: string; retryAfterSeconds?: number }
  | { kind: "network"; message?: string }
  | { kind: "timeout" }
  | { kind: "abort" }
  | { kind: "invalid-json"; message?: string };

export interface CheckResult<TData = unknown> {
  id: string;
  label: string;
  status: CheckStatus;
  /** One-line German summary shown in the report. */
  summary: string;
  error?: NormalizedError;
  data?: TData;
}

/** A single OpenRouter catalog entry, narrowed to the fields the doctor uses. */
export interface CatalogEntry {
  id: string;
  name?: string;
  context_length?: number;
  supported_parameters?: string[];
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
  };
}

/** One upstream provider endpoint for a model, from OpenRouter's endpoints listing. */
export interface EndpointEntry {
  providerName: string;
  tag?: string;
  contextLength?: number;
  supportedParameters?: string[];
}

export type CheckMode = "quick" | "deep";

export interface DiagnosisReport {
  /** Fully-qualified id as configured in Pi, e.g. "openrouter/openai/gpt-oss-120b". */
  configuredModelId: string;
  /** OpenRouter's own id, e.g. "openai/gpt-oss-120b". */
  orModelId: orModelId;
  mode: CheckMode;
  status: OverallStatus;
  checks: CheckResult[];
  recommendations: string[];
  generatedAt: string;
}

export const MAX_PROVIDERS_TO_ISOLATE = 3;
export const REQUEST_TIMEOUT_MS = 10_000;
export const MAX_CONCURRENT_REQUESTS = 3;
export const MAX_RETRIES = 3;
/** A server-provided Retry-After must never keep the interactive command waiting indefinitely. */
export const MAX_RETRY_AFTER_MS = 10_000;
export const CIRCUIT_BREAKER_FAILURE_THRESHOLD = 3;
export const CIRCUIT_BREAKER_OPEN_MS = 5 * 60_000;
export const INFERENCE_MAX_TOKENS = 8;
export const OPENROUTER_API_BASE_URL = "https://openrouter.ai/api/v1";
