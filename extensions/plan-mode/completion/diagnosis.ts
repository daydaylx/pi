/**
 * Read-only preview of the completion checks (`/verify-gate`).
 *
 * This is a diagnosis, never a decision: it reuses the exact same check
 * functions as runCompletionPipeline and the exact same classification, so a
 * second result policy cannot drift from the binding one. What it deliberately
 * does NOT do is the part that makes completion binding — no independent
 * reviewer, no diff-stability re-capture, no workflow state write, no report
 * and no archive. `/finish` and `/task-done` remain the only paths to `done`.
 */
import { captureDiffEvidence } from "./diff-evidence.ts";
import { classifyCompletionResult } from "./result-policy.ts";
import { hardBoundaryCheck } from "./secret-boundary.ts";
import {
  runVerificationChecks,
  verificationCoverageCheck,
} from "./verification.ts";
import type {
  ChangedFile,
  CompletionCheck,
  CompletionVerificationContext,
} from "./types.ts";

export interface CompletionDiagnosis {
  status: "pass" | "fail" | "blocked";
  changedFiles: ChangedFile[];
  diffStat: string;
  checks: CompletionCheck[];
  residualRisks: string[];
}

export async function diagnoseCompletion(
  ctx: CompletionVerificationContext,
): Promise<CompletionDiagnosis> {
  const evidence = await captureDiffEvidence(ctx.projectRoot, ctx.exec);
  const checks: CompletionCheck[] = [
    evidence.diffCheck,
    hardBoundaryCheck(evidence.changedFiles),
  ];
  const verification = await runVerificationChecks(ctx);
  checks.push(...verification.checks);
  // Only meaningful with something declared: without a plan or direct task the
  // check would report "not_run" and drag the whole diagnosis to "blocked",
  // which would say "we could not verify" where nothing was ever claimed.
  if (ctx.plan || ctx.directTask) {
    checks.push(verificationCoverageCheck(ctx, checks));
  }

  const aggregate = classifyCompletionResult(checks);
  return {
    status: aggregate.status,
    changedFiles: evidence.changedFiles,
    diffStat: evidence.diffStat,
    checks,
    residualRisks: [
      ...evidence.warnings,
      ...verification.risks,
      ...aggregate.residualRisks,
    ],
  };
}

export function formatCompletionDiagnosis(
  diagnosis: CompletionDiagnosis,
): string {
  const lines = [
    "Verifikations-Diagnose (kein Abschluss)",
    `Status: ${diagnosis.status.toUpperCase()}`,
    "",
    "Geänderte Dateien (Working Tree):",
  ];
  if (diagnosis.changedFiles.length === 0) {
    lines.push("  (keine)");
  } else {
    for (const file of diagnosis.changedFiles) {
      lines.push(`  ${file.status} ${file.path}`);
    }
  }
  if (diagnosis.diffStat) lines.push("", "Diff-Stat:", diagnosis.diffStat);
  lines.push("", "Prüfungen:");
  for (const check of diagnosis.checks) {
    lines.push(
      `- ${check.status.toUpperCase()} [${check.classification}] ${check.name}: ${check.summary}`,
    );
  }
  if (diagnosis.residualRisks.length > 0) {
    lines.push("", "Restrisiken:");
    for (const risk of diagnosis.residualRisks) lines.push(`- ${risk}`);
  }
  lines.push(
    "",
    "Scope, unabhängiger Reviewer und Diff-Stabilität prüft ausschließlich /finish bzw. /task-done.",
  );
  return lines.join("\n");
}
