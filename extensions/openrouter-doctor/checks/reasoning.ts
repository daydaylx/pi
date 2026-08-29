/**
 * Deep check: technical reasoning-parameter compatibility only — never an
 * assessment of reasoning *quality* (out of scope, see README "Grenzen").
 */
import { orFetchJson, type CircuitBreaker } from "../http.ts";
import { normalizeError } from "../diagnostics/normalize-error.ts";
import type { CatalogEntry, CheckResult } from "../types.ts";

interface ReasoningCheckDeps {
  baseUrl: string;
  headers: Record<string, string>;
  gate: ReturnType<typeof import("../http.ts").createRequestGate>;
  breaker: CircuitBreaker;
  signal: AbortSignal;
}

interface ReasoningResponse {
  choices?: Array<{ message?: { reasoning?: unknown; reasoning_details?: unknown } }>;
}

export async function checkReasoningCompatibility(
  orModelId: string,
  entry: CatalogEntry | undefined,
  deps: ReasoningCheckDeps,
): Promise<CheckResult> {
  const catalogAdvertises = entry?.supported_parameters?.includes("reasoning") ?? false;
  const body = {
    model: orModelId,
    messages: [{ role: "user", content: "Reply exactly with: OK" }],
    reasoning: { effort: "low" },
    max_tokens: 16,
  };
  const result = await orFetchJson(
    `${deps.baseUrl}/chat/completions`,
    { method: "POST", headers: deps.headers, body: JSON.stringify(body) },
    deps,
    { maxRetries: 0 },
  );
  if (!result.ok) {
    return {
      id: "reasoning",
      label: "Reasoning",
      status: "fail",
      summary: "Der Reasoning-Parameter wurde vom ausgewählten Endpoint abgelehnt.",
      error: normalizeError(result.error),
    };
  }
  const message = (result.json as ReasoningResponse).choices?.[0]?.message;
  const gotReasoning = Boolean(message?.reasoning ?? message?.reasoning_details);
  if (gotReasoning) {
    return { id: "reasoning", label: "Reasoning", status: "ok", summary: "Reasoning-Parameter wird akzeptiert und verwendet." };
  }
  if (!catalogAdvertises) {
    return {
      id: "reasoning",
      label: "Reasoning",
      status: "warn",
      summary:
        "Normale Requests funktionieren. Der ausgewählte Endpoint meldet im Katalog keine Unterstützung für den angeforderten Reasoning-Parameter.",
    };
  }
  return {
    id: "reasoning",
    label: "Reasoning",
    status: "warn",
    summary: "Request wurde angenommen, der Reasoning-Parameter scheint aber ignoriert worden zu sein.",
  };
}
