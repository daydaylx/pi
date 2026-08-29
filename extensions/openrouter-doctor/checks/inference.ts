/** Minimal, cheap inference request: proves the model actually accepts and answers requests. */
import { orFetchJson, type CircuitBreaker } from "../http.ts";
import { normalizeError } from "../diagnostics/normalize-error.ts";
import { INFERENCE_MAX_TOKENS } from "../types.ts";
import type { CheckResult } from "../types.ts";

const PROBE_PROMPT = "Reply exactly with: OK";

interface InferenceCheckDeps {
  baseUrl: string;
  headers: Record<string, string>;
  gate: ReturnType<typeof import("../http.ts").createRequestGate>;
  breaker: CircuitBreaker;
  signal: AbortSignal;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string; role?: string } }>;
}

function extractContent(json: unknown): string | undefined {
  const response = json as ChatCompletionResponse;
  return response.choices?.[0]?.message?.content;
}

export async function checkInference(
  orModelId: string,
  deps: InferenceCheckDeps,
): Promise<CheckResult<{ content?: string }>> {
  const body = {
    model: orModelId,
    messages: [{ role: "user", content: PROBE_PROMPT }],
    max_tokens: INFERENCE_MAX_TOKENS,
  };
  const result = await orFetchJson(
    `${deps.baseUrl}/chat/completions`,
    { method: "POST", headers: deps.headers, body: JSON.stringify(body) },
    deps,
    { maxRetries: 0 },
  );
  if (!result.ok) {
    return {
      id: "inference",
      label: "Inference",
      status: "fail",
      summary: "Minimaler Inference-Request fehlgeschlagen.",
      error: normalizeError(result.error),
    };
  }
  const content = extractContent(result.json);
  if (content === undefined) {
    return {
      id: "inference",
      label: "Inference",
      status: "warn",
      summary: "Antwort erhalten, aber im unerwarteten Format.",
      data: {},
    };
  }
  return { id: "inference", label: "Inference", status: "ok", summary: "Modell antwortet auf Anfragen.", data: { content } };
}
