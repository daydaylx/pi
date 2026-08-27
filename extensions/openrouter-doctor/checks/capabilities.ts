/** Pure, no-network summary of what the catalog says the model can do. */
import type { CatalogEntry, CheckResult } from "../types.ts";

export interface CapabilitiesData {
  modalities: string[];
  supportedParameters: string[];
  missing: string[];
}

const PI_RELEVANT_PARAMETERS = ["tools", "tool_choice", "reasoning", "structured_outputs"] as const;
const PARAMETER_LABELS: Record<string, string> = {
  tools: "Tools",
  tool_choice: "Tool Choice",
  reasoning: "Reasoning",
  structured_outputs: "Structured Outputs",
};

/** Derives a Pi-relevant capability summary from a catalog entry. No network, no LLM call. */
export function checkCapabilities(entry: CatalogEntry | undefined): CheckResult<CapabilitiesData> {
  if (!entry) {
    return { id: "capabilities", label: "Capabilities", status: "unknown", summary: "Keine Katalog-Daten verfügbar." };
  }
  const supportedParameters = entry.supported_parameters ?? [];
  const modalities = [
    ...(entry.architecture?.input_modalities ?? ["text"]),
    entry.architecture?.output_modalities?.includes("image") ? "image-output" : undefined,
  ].filter((value): value is string => Boolean(value));
  const present = PI_RELEVANT_PARAMETERS.filter((parameter) => supportedParameters.includes(parameter));
  const missing = PI_RELEVANT_PARAMETERS.filter((parameter) => !supportedParameters.includes(parameter));
  const summary =
    present.length === 0
      ? "Keine der Pi-relevanten Zusatzfähigkeiten laut Katalog gemeldet."
      : `Laut Katalog: ${present.map((p) => PARAMETER_LABELS[p]).join(", ")}` +
        (missing.length > 0 ? `; nicht gemeldet: ${missing.map((p) => PARAMETER_LABELS[p]).join(", ")}` : "");
  return {
    id: "capabilities",
    label: "Capabilities",
    status: "ok",
    summary,
    data: { modalities, supportedParameters, missing: missing.map((p) => PARAMETER_LABELS[p] ?? p) },
  };
}
