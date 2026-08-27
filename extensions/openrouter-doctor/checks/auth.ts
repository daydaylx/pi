/** Verifies the resolved OpenRouter key actually works, at zero token cost. */
import { orFetchJson, type CircuitBreaker } from "../http.ts";
import { normalizeError } from "../diagnostics/normalize-error.ts";
import type { CheckResult } from "../types.ts";

interface AuthCheckDeps {
  baseUrl: string;
  headers: Record<string, string>;
  gate: ReturnType<typeof import("../http.ts").createRequestGate>;
  breaker: CircuitBreaker;
  signal: AbortSignal;
}

/** GET /key: returns account/key info, does not run inference — no token cost. */
export async function checkAuth(deps: AuthCheckDeps): Promise<CheckResult> {
  const result = await orFetchJson(`${deps.baseUrl}/key`, { headers: deps.headers }, deps);
  if (!result.ok) {
    return {
      id: "auth",
      label: "Authentication",
      status: "fail",
      summary: "Authentifizierung fehlgeschlagen.",
      error: normalizeError(result.error),
    };
  }
  return { id: "auth", label: "Authentication", status: "ok", summary: "Authentifizierung funktioniert." };
}
