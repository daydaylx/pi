/** Pure report formatting: DiagnosisReport → German report text for ctx.ui.notify. */
import { limitTextOutput } from "../../shared/output-limits.ts";
import { explainError } from "../diagnostics/explain-error.ts";
import { CHECK_ICON, CHECK_STATUS_TEXT, STATUS_LABEL, STRINGS } from "./strings.ts";
import type { ProviderIsolationResult } from "../checks/provider-isolation.ts";
import type { CheckResult, DiagnosisReport } from "../types.ts";

function formatCheckLine(check: CheckResult, details: boolean): string[] {
  const icon = CHECK_ICON[check.status];
  const lines = [`${icon} ${check.label} (${CHECK_STATUS_TEXT[check.status]})`, `  ${check.summary}`];
  if (check.error && check.status !== "ok") {
    for (const line of explainError(check.error, { details })) lines.push(`  ${line}`);
  }
  return lines;
}

function formatProviderDiagnosis(check: CheckResult | undefined): string[] {
  if (!check || check.id !== "providers" || !check.data) return [];
  const providers = check.data as ProviderIsolationResult[];
  const lines = [STRINGS.sectionProviderDiagnosis, STRINGS.divider];
  for (const provider of providers) {
    lines.push(`${CHECK_ICON[provider.status]} ${provider.providerName}: ${provider.summary}`);
  }
  return [...lines, ""];
}

function diagnosisParagraph(report: DiagnosisReport): string {
  if (report.status === "HEALTHY") {
    return "Alle für den gewählten Modus geprüften Punkte funktionieren.";
  }
  if (report.status === "BROKEN") {
    const cause = report.checks.find((check) => check.status === "fail" && check.error);
    return cause
      ? `Das Modell ist im aktuellen Zustand nicht nutzbar. ${cause.error!.humanSummary}`
      : "Das Modell ist im aktuellen Zustand nicht nutzbar.";
  }
  return "Das Modell funktioniert grundsätzlich, aber nicht uneingeschränkt für die von Pi tatsächlich benötigten Anforderungen.";
}

/** Formats the full doctor report. Never includes raw stack traces or secrets. */
export function formatReport(report: DiagnosisReport, options: { details?: boolean } = {}): string {
  const details = options.details ?? false;
  const providerCheck = report.checks.find((check) => check.id === "providers");
  const otherChecks = report.checks.filter((check) => check.id !== "providers");

  const lines: string[] = [
    STRINGS.title,
    STRINGS.divider,
    "",
    STRINGS.modelLabel,
    report.configuredModelId,
    "",
    STRINGS.statusLabel,
    STATUS_LABEL[report.status],
    "",
    ...otherChecks.flatMap((check) => formatCheckLine(check, details)),
    "",
    ...formatProviderDiagnosis(providerCheck),
    STRINGS.sectionDiagnosis,
    STRINGS.divider,
    "",
    diagnosisParagraph(report),
    "",
    STRINGS.sectionRecommendedAction,
    STRINGS.divider,
    "",
    ...(report.recommendations.length > 0
      ? report.recommendations.map((recommendation) => `- ${recommendation}`)
      : ["Keine Empfehlung nötig."]),
    "",
    STRINGS.noConfigChanged,
  ];
  return limitTextOutput(lines.join("\n")).text;
}
