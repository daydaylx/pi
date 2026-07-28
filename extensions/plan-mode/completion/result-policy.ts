/**
 * The pass/fail/blocked decision — pure and deterministic.
 *
 * Classification drives the outcome: a failing `required` or `recommended`
 * check fails the completion, a `required` check that could not run blocks it,
 * and anything `advisory` only ever becomes a residual risk. The separation
 * matters because "we could not check" must never read as "we checked and it
 * was fine".
 */
import type { CompletionCheck, CompletionPipelineResult } from "./types.ts";

export interface CompletionClassificationResult {
  status: CompletionPipelineResult["status"];
  residualRisks: string[];
}

export function classifyCompletionResult(
  checks: readonly CompletionCheck[],
): CompletionClassificationResult {
  const residualRisks: string[] = [];
  let failed = false;
  let blocked = false;
  for (const check of checks) {
    if (check.classification === "advisory") {
      if (check.status !== "pass")
        residualRisks.push(`${check.name}: ${check.summary}`);
      continue;
    }
    if (check.classification === "recommended") {
      if (check.status === "fail") failed = true;
      if (check.status === "not_run")
        residualRisks.push(`${check.name}: ${check.summary}`);
      continue;
    }
    if (check.status === "fail") failed = true;
    if (check.status === "not_run") blocked = true;
  }
  return {
    status: failed ? "fail" : blocked ? "blocked" : "pass",
    residualRisks,
  };
}

/**
 * Whether a failed completion may be overridden at all.
 *
 * Hard secret/auth boundaries are never overridable (Umbauvertrag §13.2), so
 * this is the single gate every override path has to ask.
 */
export function canOverrideCompletion(
  checks: readonly CompletionCheck[],
): boolean {
  return (
    checks.find((check) => check.name === "hard-boundaries")?.status === "pass"
  );
}
