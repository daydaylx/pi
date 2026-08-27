/**
 * Deterministic error normalization: raw HTTP/network signal → one of a
 * fixed set of categories → German explanation. No LLM involved (by
 * design — see README "Grenzen"): a wrong deterministic guess is at least
 * consistently wrong, a hallucinated one is not.
 */
import type { ErrorCategory, NormalizedError, RawCheckError } from "../types.ts";

function includesAny(haystack: string, needles: readonly string[]): boolean {
  const lower = haystack.toLowerCase();
  return needles.some((needle) => lower.includes(needle));
}

const NO_ENDPOINTS_HINTS = ["no endpoints", "no allowed providers"] as const;

function categorizeHttp(status: number, message: string): ErrorCategory {
  if (includesAny(message, NO_ENDPOINTS_HINTS)) return "no-endpoints";
  switch (status) {
    case 401:
      return "authentication";
    case 403:
      return "permission";
    case 404:
      return "model-not-found";
    case 429:
      return "rate-limit";
    case 400:
      return "invalid-request";
    case 502:
    case 503:
    case 524:
    case 529:
      return "gateway";
    default:
      return "unknown";
  }
}

interface CategoryExplanation {
  humanSummary: string;
  likelyCauses: string[];
  recommendedAction: string;
}

function explanationFor(
  category: ErrorCategory,
  status: number | undefined,
  message: string,
): CategoryExplanation {
  switch (category) {
    case "authentication":
      return {
        humanSummary:
          "Authentifizierung fehlgeschlagen. OpenRouter ist erreichbar, aber der API-Key wurde abgelehnt.",
        likelyCauses: ["Ungültiger Key", "Abgelaufener/widerrufener Key", "Falsche Credential-Quelle"],
        recommendedAction: "API-Key prüfen (Pi's eigene Credential-Verwaltung).",
      };
    case "permission":
      return {
        humanSummary: "Zugriff verweigert (403). Die genaue Ursache ist von außen nicht eindeutig bestimmbar.",
        likelyCauses: [
          "Account-Einschränkung",
          "Modell-Einschränkung",
          "Provider-Einschränkung",
          "Budget-/Ausgabenregel",
          "Guardrail/Policy",
        ],
        recommendedAction: "OpenRouter-Account-Einstellungen und Budgetregeln prüfen.",
      };
    case "model-not-found":
      return {
        humanSummary: "Modell-ID nicht gefunden (404).",
        likelyCauses: ["Modell-ID falsch/Tippfehler", "Modell wurde entfernt", "Preview abgelaufen", "Falscher Endpoint"],
        recommendedAction: "Modell-ID im OpenRouter-Katalog gegenprüfen.",
      };
    case "no-endpoints":
      return {
        humanSummary:
          "Kein kompatibler OpenRouter-Endpoint verfügbar. Das Modell existiert, aber kein aktiver Provider erfüllt die angeforderten Parameter.",
        likelyCauses: [
          "Alle Upstream-Provider sind aktuell nicht verfügbar",
          "Angeforderte Parameter (z. B. Tools/Reasoning) werden von keinem aktiven Endpoint unterstützt",
        ],
        recommendedAction: "Andere Provider-Kompatibilität wählen oder später erneut versuchen.",
      };
    case "rate-limit":
      return {
        humanSummary: "Rate Limit erreicht (429).",
        likelyCauses: rateLimitCauses(message),
        recommendedAction: "Später erneut versuchen (Retry-After beachten, falls angegeben).",
      };
    case "invalid-request":
      return {
        humanSummary: `Ungültige Anfrage (400)${affectedParameterSuffix(message)}.`,
        likelyCauses: ["Nicht unterstützter Parameter", "Falsches Feldformat"],
        recommendedAction: "Betroffenen Parameter aus der Anfrage entfernen oder korrigieren.",
      };
    case "gateway":
      return {
        humanSummary: `${status ?? ""} – Gateway-/Provider-Problem. Die eigene Pi-Konfiguration ist wahrscheinlich nicht die Ursache.`.trim(),
        likelyCauses: ["Upstream-Provider überlastet", "Kurzzeitiger Gateway-Fehler bei OpenRouter"],
        recommendedAction: "Später erneut versuchen oder vorübergehend einen anderen Provider/ein anderes Modell wählen.",
      };
    case "timeout":
      return {
        humanSummary: "Zeitüberschreitung bei der Anfrage.",
        likelyCauses: ["Netzwerk", "OpenRouter selbst", "Upstream-Provider braucht ungewöhnlich lange"],
        recommendedAction: "Später erneut versuchen.",
      };
    case "network":
      return {
        humanSummary: "OpenRouter nicht erreichbar (Netzwerkfehler).",
        likelyCauses: ["Keine Internetverbindung", "DNS-/Proxy-Problem", "OpenRouter nicht erreichbar"],
        recommendedAction: "Netzwerkverbindung prüfen und später erneut versuchen.",
      };
    default:
      return {
        humanSummary: "Antwort konnte nicht eindeutig interpretiert werden.",
        likelyCauses: ["Unerwartetes Antwortformat", "Unbekannter Fehlercode"],
        recommendedAction: "Technische Details prüfen (--details) oder später erneut versuchen.",
      };
  }
}

function rateLimitCauses(message: string): string[] {
  if (includesAny(message, ["credit", "quota", "budget"])) {
    return ["Account-/Guthaben-Limit erreicht", "OpenRouter-eigenes Rate Limit", "Provider-eigenes Rate Limit"];
  }
  return ["OpenRouter-eigenes Rate Limit", "Provider-eigenes Rate Limit", "Account-/Guthaben-Limit"];
}

function affectedParameterSuffix(message: string): string {
  const match = message.match(/["'`]?([a-zA-Z0-9_.]+)["'`]?\s+(?:is not|not|is unsupported|unsupported)/i);
  return match ? ` — betroffener Parameter vermutlich: ${match[1]}` : "";
}

/** Pure mapping from a raw observed error to a normalized, explainable one. */
export function normalizeError(raw: RawCheckError): NormalizedError {
  const message = "message" in raw && raw.message ? raw.message : "";
  if (raw.kind === "http") {
    const category = categorizeHttp(raw.status, message);
    const explanation = explanationFor(category, raw.status, message);
    return {
      category,
      httpStatus: raw.status,
      retryAfterSeconds: raw.retryAfterSeconds,
      rawDetails: { status: raw.status, code: raw.code, message },
      ...explanation,
    };
  }
  if (raw.kind === "timeout" || raw.kind === "abort") {
    const explanation = explanationFor("timeout", undefined, "");
    return { category: "timeout", ...explanation };
  }
  if (raw.kind === "invalid-json") {
    const explanation = explanationFor("unknown", undefined, "");
    return {
      category: "unknown",
      humanSummary: "OpenRouter hat kein gültiges JSON zurückgegeben.",
      likelyCauses: explanation.likelyCauses,
      recommendedAction: explanation.recommendedAction,
    };
  }
  if (raw.kind === "network" && message === "circuit-open") {
    return {
      category: "network",
      humanSummary: "OpenRouter scheint nicht verfügbar zu sein (mehrere aufeinanderfolgende Verbindungsfehler).",
      likelyCauses: ["Mehrere aufeinanderfolgende Netzwerkfehler gegen OpenRouter"],
      recommendedAction: "In ein paar Minuten erneut versuchen (automatische Pause von 5 Minuten aktiv).",
    };
  }
  const explanation = explanationFor("network", undefined, message);
  return { category: "network", rawDetails: { message }, ...explanation };
}
