/**
 * Conservative, fixed-vocabulary recommendations. Never suggests an
 * automatic action — see README "Non-Goals": no auto model/provider switch,
 * no settings.json edits, no key rotation.
 */
import type { CheckResult, ErrorCategory } from "../types.ts";

const RECOMMENDATION_BY_CATEGORY: Partial<Record<ErrorCategory, string>> = {
  configuration: "OpenRouter-Endpoint in der Modellkonfiguration prüfen.",
  authentication: "API-Key für OpenRouter prüfen.",
  permission: "OpenRouter-Account-Einstellungen und Budgetregeln prüfen.",
  "model-not-found": "Modell-ID korrigieren.",
  "rate-limit": "Später erneut versuchen.",
  "invalid-request": "Nicht unterstützten optionalen Parameter deaktivieren.",
  gateway: "Später erneut versuchen oder vorübergehend ein anderes konfiguriertes Modell wählen.",
  timeout: "Später erneut versuchen.",
  network: "Netzwerkverbindung prüfen und später erneut versuchen.",
  "no-endpoints": "Anderen Provider manuell auswählen oder vorübergehend ein anderes Modell verwenden.",
};

/** Builds a deduplicated, ordered recommendation list from failed/warned checks. */
export function buildRecommendations(checks: readonly CheckResult[]): string[] {
  const recommendations: string[] = [];
  const seen = new Set<string>();
  const add = (text: string | undefined) => {
    if (!text || seen.has(text)) return;
    seen.add(text);
    recommendations.push(text);
  };

  for (const check of checks) {
    if (check.status === "ok") continue;
    add(check.error ? RECOMMENDATION_BY_CATEGORY[check.error.category] : undefined);
  }

  if (checks.some((check) => check.id === "strict-parameters" && check.status !== "ok")) {
    add("Nur strikt kompatible Provider verwenden (provider.require_parameters).");
  }
  if (checks.some((check) => check.id === "providers" && check.status !== "ok")) {
    add("Anderen Provider manuell auswählen.");
  }
  return recommendations;
}
