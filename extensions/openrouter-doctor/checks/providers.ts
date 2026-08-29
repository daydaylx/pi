/**
 * Deep check: strict Pi-parameter routing, and free per-provider endpoint
 * metadata. "Works at all" vs. "works with what Pi actually needs" is the
 * distinction this file exists to make (see README).
 */
import { orFetchJson, type CircuitBreaker } from "../http.ts";
import { normalizeError } from "../diagnostics/normalize-error.ts";
import type { CheckResult, EndpointEntry } from "../types.ts";

interface ProvidersCheckDeps {
  baseUrl: string;
  headers: Record<string, string>;
  gate: ReturnType<typeof import("../http.ts").createRequestGate>;
  breaker: CircuitBreaker;
  signal: AbortSignal;
}

/**
 * Compares normal routing against `provider.require_parameters=true`
 * routing for the same Pi-relevant request (tools + reasoning). Reuses the
 * caller's already-known "normal routing" outcome instead of re-sending it.
 */
export async function checkStrictParameters(
  orModelId: string,
  normalRoutingOk: boolean,
  deps: ProvidersCheckDeps,
): Promise<CheckResult> {
  if (!normalRoutingOk) {
    return {
      id: "strict-parameters",
      label: "Strict Pi compatibility",
      status: "unknown",
      summary: "Übersprungen: normales Routing funktioniert bereits nicht.",
    };
  }
  const body = {
    model: orModelId,
    messages: [{ role: "user", content: "Reply exactly with: OK" }],
    reasoning: { effort: "low" },
    provider: { require_parameters: true },
    max_tokens: 16,
  };
  const result = await orFetchJson(
    `${deps.baseUrl}/chat/completions`,
    { method: "POST", headers: deps.headers, body: JSON.stringify(body) },
    deps,
    { maxRetries: 0 },
  );
  if (result.ok) {
    return { id: "strict-parameters", label: "Strict Pi compatibility", status: "ok", summary: "Normal routing ✓, Strict Pi routing ✓." };
  }
  const error = normalizeError(result.error);
  return {
    id: "strict-parameters",
    label: "Strict Pi compatibility",
    status: "fail",
    summary:
      "Normal routing ✓, Strict Pi routing ✗ — kein aktuell verfügbarer Endpoint unterstützt alle von Pi angeforderten Parameter.",
    error,
  };
}

interface EndpointsResponse {
  data?: { endpoints?: Array<{ provider_name?: string; tag?: string; context_length?: number; supported_parameters?: string[] }> };
}

/** Free per-provider metadata (no inference cost) used to explain, not to spend requests on isolation. */
export async function listProviderEndpoints(orModelId: string, deps: ProvidersCheckDeps): Promise<EndpointEntry[]> {
  const [author, ...slugParts] = orModelId.split("/");
  const slug = slugParts.join("/");
  if (!author || !slug) return [];
  const result = await orFetchJson(`${deps.baseUrl}/models/${author}/${slug}/endpoints`, { headers: deps.headers }, deps);
  if (!result.ok) return [];
  const endpoints = (result.json as EndpointsResponse).data?.endpoints ?? [];
  return endpoints
    .filter((endpoint): endpoint is Required<Pick<typeof endpoint, "provider_name">> & typeof endpoint => Boolean(endpoint.provider_name))
    .map((endpoint) => ({
      providerName: endpoint.provider_name,
      tag: endpoint.tag,
      contextLength: endpoint.context_length,
      supportedParameters: endpoint.supported_parameters,
    }));
}
