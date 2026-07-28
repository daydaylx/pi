/**
 * User-facing rendering of a completion result.
 *
 * Presentation only — every decision has already been made by result-policy.
 */
import type { CompletionPipelineResult } from "./types.ts";

export function formatCompletionResult(
  result: CompletionPipelineResult,
): string {
  const lines = [
    `Completion: ${result.status.toUpperCase()}`,
    `Diff-Hash: ${result.diffHash}`,
    `Reviewer: ${result.reviewer.verdict}`,
    "",
    "Prüfungen:",
  ];
  for (const check of result.checks) {
    lines.push(
      `- ${check.status.toUpperCase()} [${check.classification}] ${check.name}: ${check.summary}`,
    );
  }
  if (result.scopeFindings.length > 0) {
    lines.push("", "Scope:");
    for (const finding of result.scopeFindings) lines.push(`- ${finding}`);
  }
  if (result.residualRisks.length > 0) {
    lines.push("", "Restrisiken:");
    for (const risk of result.residualRisks) lines.push(`- ${risk}`);
  }
  return lines.join("\n");
}
