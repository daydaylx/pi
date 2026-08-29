/**
 * Credential resolution for OpenRouter Doctor.
 *
 * Deliberately thin: Pi's own `ModelRegistry` remains the single owner of
 * credential resolution and storage. This module never reads `auth.json`,
 * never prompts for a key, and never persists anything of its own — it only
 * turns `ctx.modelRegistry.getApiKeyAndHeaders(model)` into request headers
 * and a base URL, or a normalized "authentication failed" result.
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Api, Model } from "@earendil-works/pi-ai";
import { OPENROUTER_API_BASE_URL } from "./types.ts";
import type { NormalizedError } from "./types.ts";

export interface ResolvedOpenRouterRequest {
  ok: true;
  headers: Record<string, string>;
  baseUrl: string;
}
export interface UnresolvedOpenRouterRequest {
  ok: false;
  error: NormalizedError;
}
export type ResolveAuthResult = ResolvedOpenRouterRequest | UnresolvedOpenRouterRequest;

/**
 * The Doctor handles OpenRouter credentials, so it must never follow a
 * configurable endpoint to an arbitrary origin. Returning the canonical URL
 * also prevents a harmless trailing slash from producing double-slash paths.
 */
function trustedOpenRouterBaseUrl(candidate: string | undefined): string | undefined {
  if (candidate === undefined) return OPENROUTER_API_BASE_URL;
  try {
    const url = new URL(candidate);
    const expected = new URL(OPENROUTER_API_BASE_URL);
    const normalizedPath = url.pathname.replace(/\/+$/, "") || "/";
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      url.hostname !== expected.hostname ||
      url.port !== "" ||
      normalizedPath !== expected.pathname ||
      url.search !== "" ||
      url.hash !== ""
    ) {
      return undefined;
    }
    return OPENROUTER_API_BASE_URL;
  } catch {
    return undefined;
  }
}

/**
 * Resolves auth for `model` via Pi's ModelRegistry. Never logs or returns
 * the raw key beyond building the one Authorization header this process
 * needs for its own outbound requests.
 */
export async function resolveOpenRouterAuth(
  ctx: Pick<ExtensionContext, "modelRegistry">,
  model: Model<Api>,
): Promise<ResolveAuthResult> {
  const resolved = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (!resolved.ok) {
    return {
      ok: false,
      error: {
        category: "authentication",
        humanSummary:
          "OpenRouter-Authentifizierung konnte nicht aufgelöst werden.",
        likelyCauses: [
          "Kein OpenRouter-API-Key konfiguriert (z. B. OPENROUTER_API_KEY nicht gesetzt)",
          "OAuth-Anmeldung für OpenRouter fehlt oder ist abgelaufen",
        ],
        recommendedAction:
          "API-Key für OpenRouter prüfen (Pi's eigene Credential-Verwaltung, z. B. OPENROUTER_API_KEY).",
        rawDetails: { message: resolved.error },
      },
    };
  }
  const baseUrl = trustedOpenRouterBaseUrl(resolved.baseUrl ?? model.baseUrl);
  if (!baseUrl) {
    return {
      ok: false,
      error: {
        category: "configuration",
        humanSummary: "Der konfigurierte OpenRouter-Endpoint ist nicht zulässig.",
        likelyCauses: [
          "Das OpenRouter-Modell verweist nicht auf https://openrouter.ai/api/v1",
          "Die Endpoint-URL enthält eine Umleitung, Zugangsdaten, Query-Parameter oder einen abweichenden Pfad",
        ],
        recommendedAction:
          "OpenRouter-Modell auf den offiziellen HTTPS-Endpoint https://openrouter.ai/api/v1 zurücksetzen.",
      },
    };
  }
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (resolved.headers) {
    for (const [key, value] of Object.entries(resolved.headers)) {
      if (typeof value === "string") headers[key] = value;
    }
  }
  if (resolved.apiKey) headers.authorization = `Bearer ${resolved.apiKey}`;
  return {
    ok: true,
    headers,
    baseUrl,
  };
}
