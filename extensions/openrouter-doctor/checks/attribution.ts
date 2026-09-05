/**
 * Detects OpenRouter's "Gate Free Endpoints by Agentic Harness" gate:
 * some free endpoints (e.g. thinkingmachines/inkling:free) 403 every request
 * that does not carry recognizable CLI-agent attribution headers
 * (HTTP-Referer / X-OpenRouter-Title / X-OpenRouter-Categories). Pi's own
 * default attribution is coupled to `enableInstallTelemetry`, so a user who
 * disables install telemetry silently loses it for every OpenRouter request.
 *
 * This check never changes headers or settings — it only explains an
 * observed Inference failure that matches the gate's signature, pointing at
 * the actually supported fix: a `providers.openrouter.headers` entry in
 * `~/.pi/agent/models.json`, which is independent of `enableInstallTelemetry`.
 */
import type { CheckResult, NormalizedError } from "../types.ts";

const HARNESS_GATE_HINTS = ["agentic harness", "gate free endpoints"] as const;

const ATTRIBUTION_HEADER_NAMES = [
  "x-openrouter-categories",
  "http-referer",
  "x-openrouter-title",
] as const;

function includesAny(haystack: string, needles: readonly string[]): boolean {
  const lower = haystack.toLowerCase();
  return needles.some((needle) => lower.includes(needle));
}

/** True when a failed Inference check's raw message matches OpenRouter's harness-gate wording. */
function isAgenticHarnessGate(error: NormalizedError | undefined): boolean {
  if (!error || error.httpStatus !== 403) return false;
  return includesAny(error.rawDetails?.message ?? "", HARNESS_GATE_HINTS);
}

/** True when the outgoing request headers already carry recognizable CLI-agent attribution. */
function hasRecognizableAttribution(headers: Record<string, string>): boolean {
  const present = new Set(
    Object.keys(headers).map((name) => name.toLowerCase()),
  );
  return ATTRIBUTION_HEADER_NAMES.some((name) => present.has(name));
}

const RECOMMENDED_ACTION =
  'In ~/.pi/agent/models.json unter providers.openrouter.headers "HTTP-Referer", "X-OpenRouter-Title" und "X-OpenRouter-Categories" setzen (siehe docs/models.md → Custom Headers). Das wirkt unabhängig von enableInstallTelemetry.';

/**
 * Interprets an already-run Inference check against the request headers that
 * produced it. Not applicable → "ok" (matches existing convention: only a
 * genuine problem should keep a report from being HEALTHY).
 */
export function checkAttribution(
  inference: CheckResult,
  headers: Record<string, string>,
): CheckResult {
  if (!isAgenticHarnessGate(inference.error)) {
    return {
      id: "attribution",
      label: "Attribution",
      status: "ok",
      summary: "Kein Agentic-Harness-Gating erkannt.",
    };
  }

  if (hasRecognizableAttribution(headers)) {
    return {
      id: "attribution",
      label: "Attribution",
      status: "warn",
      summary:
        "CLI-Agent-Attribution ist gesetzt, das Modell blockiert die Anfrage trotzdem.",
      error: {
        category: "attribution",
        httpStatus: 403,
        humanSummary:
          "Attribution-Header sind vorhanden, OpenRouter blockiert die Anfrage aber weiterhin am Agentic-Harness-Gate.",
        likelyCauses: [
          "OpenRouter erkennt den gesendeten Title/Referer-Wert nicht als bekannten Coding-Agenten",
          "Das Gate wurde für dieses Modell zusätzlich verschärft oder verlangt andere Werte",
        ],
        recommendedAction:
          "Attribution-Werte gegen einen bekannten, aktuell funktionierenden CLI-Agenten prüfen.",
      },
    };
  }

  return {
    id: "attribution",
    label: "Attribution",
    status: "fail",
    summary:
      "OpenRouter-Modell benötigt Agentic-Harness-Attribution, aber der aktuelle Request enthält keine erkennbare CLI-Agent-Attribution.",
    error: {
      category: "attribution",
      httpStatus: 403,
      humanSummary:
        "OpenRouter-Modell benötigt Agentic-Harness-Attribution, aber der aktuelle Request enthält keine erkennbare CLI-Agent-Attribution.",
      likelyCauses: [
        "enableInstallTelemetry ist deaktiviert, wodurch Pi's eingebaute Standard-Attribution für OpenRouter-Requests komplett entfällt",
        "Kein providers.openrouter.headers-Eintrag in ~/.pi/agent/models.json konfiguriert",
      ],
      recommendedAction: RECOMMENDED_ACTION,
    },
  };
}
