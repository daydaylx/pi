/**
 * Bounded per-provider isolation: only runs when Deep Check already found a
 * problem, and only against at most MAX_PROVIDERS_TO_ISOLATE providers, to
 * keep cost predictable (see README "Kostenkontrolle").
 */
import { orFetchJson, type CircuitBreaker } from "../http.ts";
import { normalizeError } from "../diagnostics/normalize-error.ts";
import { MAX_PROVIDERS_TO_ISOLATE } from "../types.ts";
import type { CheckResult, EndpointEntry } from "../types.ts";

interface IsolationDeps {
  baseUrl: string;
  headers: Record<string, string>;
  gate: ReturnType<typeof import("../http.ts").createRequestGate>;
  breaker: CircuitBreaker;
  signal: AbortSignal;
}

export interface ProviderIsolationResult {
  providerName: string;
  status: "ok" | "fail";
  summary: string;
}

async function probeProvider(
  orModelId: string,
  providerName: string,
  deps: IsolationDeps,
): Promise<ProviderIsolationResult> {
  const body = {
    model: orModelId,
    messages: [{ role: "user", content: "Reply exactly with: OK" }],
    provider: { only: [providerName], allow_fallbacks: false },
    max_tokens: 8,
  };
  const result = await orFetchJson(
    `${deps.baseUrl}/chat/completions`,
    { method: "POST", headers: deps.headers, body: JSON.stringify(body) },
    deps,
  );
  if (result.ok) return { providerName, status: "ok", summary: "Kompatibel." };
  const error = normalizeError(result.error);
  return { providerName, status: "fail", summary: error.humanSummary };
}

/**
 * Sequential by design (not parallel): each isolated probe is a real,
 * billable request, so this must stay easy to reason about and cheap to
 * abort mid-way, not fast.
 */
export async function isolateProviders(
  orModelId: string,
  endpoints: readonly EndpointEntry[],
  deps: IsolationDeps,
): Promise<CheckResult<ProviderIsolationResult[]>> {
  const candidates = endpoints.slice(0, MAX_PROVIDERS_TO_ISOLATE);
  if (candidates.length === 0) {
    return { id: "providers", label: "Provider diagnosis", status: "unknown", summary: "Keine Provider-Endpoints ermittelbar." };
  }
  const results: ProviderIsolationResult[] = [];
  for (const endpoint of candidates) {
    if (deps.signal.aborted) break;
    results.push(await probeProvider(orModelId, endpoint.providerName, deps));
  }
  const anyOk = results.some((entry) => entry.status === "ok");
  const allOk = results.every((entry) => entry.status === "ok");
  return {
    id: "providers",
    label: "Provider diagnosis",
    status: allOk ? "ok" : anyOk ? "warn" : "fail",
    summary: allOk
      ? `Alle geprüften Provider (${results.length}) kompatibel.`
      : `${results.filter((entry) => entry.status === "ok").length}/${results.length} geprüfte Provider kompatibel.`,
    data: results,
  };
}
