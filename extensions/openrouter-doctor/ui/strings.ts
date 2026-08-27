/** Central German UI strings — kept in one place for future localization. */
import type { CheckStatus, OverallStatus } from "../types.ts";

export const STRINGS = {
  title: "OpenRouter Doctor",
  pickerTitle: "OpenRouter Doctor — Modell wählen",
  pickerNonInteractiveHint:
    "OpenRouter Doctor benötigt den interaktiven TUI-Modus für den Modell-Picker. Nutze /openrouter-doctor <model-id> stattdessen.",
  noModelsConfigured:
    "Keine konfigurierten OpenRouter-Modelle gefunden (settings.json → enabledModels bzw. --models).",
  unknownArgument: (arg: string) => `Unbekanntes Argument: ${arg}`,
  usage: "Nutzung: /openrouter-doctor [<model-id>] [--deep] [--details]",
  runningQuick: "OpenRouter Doctor: Quick Check läuft…",
  runningDeep: "OpenRouter Doctor: Deep Check läuft…",
  noConfigChanged: "Es wurde keine Konfiguration geändert.",
  sectionCatalog: "Catalog",
  sectionCapabilities: "Capabilities",
  sectionProviderDiagnosis: "Provider diagnosis",
  sectionDiagnosis: "Diagnosis",
  sectionRecommendedAction: "Recommended action",
  modelLabel: "Model",
  statusLabel: "Status",
  divider: "─".repeat(40),
} as const;

export const STATUS_LABEL: Record<OverallStatus, string> = {
  HEALTHY: "HEALTHY",
  DEGRADED: "DEGRADED",
  BROKEN: "BROKEN",
};

export const CHECK_ICON: Record<CheckStatus, string> = {
  ok: "✓",
  warn: "⚠",
  fail: "✗",
  unknown: "?",
};

export const CHECK_STATUS_TEXT: Record<CheckStatus, string> = {
  ok: "OK",
  warn: "eingeschränkt",
  fail: "fehlgeschlagen",
  unknown: "unbekannt",
};
