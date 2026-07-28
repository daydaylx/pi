/**
 * The independent reviewer step.
 *
 * Builds the reviewer input, calls the injected reviewer and validates its
 * answer. The verdict marker is a strict contract: exactly one marker, and it
 * must be the last non-empty line — anything else is UNVERIFIABLE rather than
 * a generous reading. Scope is not re-evaluated here and no diff is captured;
 * both arrive as arguments.
 */
import { isSecretPath } from "./secret-boundary.ts";
import type {
  ChangedFile,
  CompletionCheck,
  CompletionPipelineContext,
  CompletionReviewerInput,
  CompletionReviewerResult,
  CompletionReviewerVerdict,
  DiffEvidence,
} from "./types.ts";

export function buildReviewerInput(
  ctx: CompletionPipelineContext,
  evidence: DiffEvidence,
  hardBoundary: CompletionCheck,
  checks: CompletionCheck[],
  scopeFindings: string[],
): CompletionReviewerInput {
  return {
    plan: ctx.plan,
    directTask: ctx.directTask,
    changedFiles: evidence.changedFiles.filter(
      (file: ChangedFile) => !isSecretPath(file.path),
    ),
    diff:
      hardBoundary.status === "pass"
        ? evidence.reviewDiff
        : "(Diff wegen erkannter Secret-/Auth-Pfade nicht an den Reviewer übermittelt.)",
    diffHash: evidence.diffHash,
    checks,
    scopeFindings,
  };
}

export function parseCompletionReviewerResult(
  text: string,
): CompletionReviewerResult {
  const markers = [
    ...text.matchAll(/\[COMPLETION-REVIEW:(PASS|REWORK|UNVERIFIABLE)\]/gi),
  ].map((match) => match[1]?.toUpperCase() as CompletionReviewerVerdict);
  const finalLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);
  if (
    markers.length !== 1 ||
    finalLine !== `[COMPLETION-REVIEW:${markers[0] ?? "UNVERIFIABLE"}]`
  ) {
    return {
      verdict: "UNVERIFIABLE",
      summary:
        markers.length === 0
          ? "Verbindlicher Reviewer-Marker fehlt."
          : markers.length > 1
            ? "Reviewer-Ausgabe enthält mehrere widersprüchliche Marker."
            : "Reviewer-Marker ist nicht die letzte nichtleere Zeile.",
      raw: text,
    };
  }
  const marker = markers[0] as CompletionReviewerVerdict;
  return {
    verdict: marker,
    summary:
      text.replace(/\[COMPLETION-REVIEW:[^\]]+\]/gi, "").trim() ||
      `Reviewer-Urteil: ${marker}`,
    raw: text,
  };
}

/** Only PASS is a pass; REWORK fails, everything else stays unverifiable. */
export function reviewerCheck(
  result: CompletionReviewerResult,
): CompletionCheck {
  return {
    name: "independent-reviewer",
    classification: "required",
    status:
      result.verdict === "PASS"
        ? "pass"
        : result.verdict === "REWORK"
          ? "fail"
          : "not_run",
    summary: result.summary,
  };
}

/** Calls the reviewer; a throwing reviewer is UNVERIFIABLE, never a pass. */
export async function runReviewerCheck(
  ctx: CompletionPipelineContext,
  input: CompletionReviewerInput,
): Promise<CompletionReviewerResult> {
  try {
    return await ctx.runReviewer(input);
  } catch (error) {
    return {
      verdict: "UNVERIFIABLE",
      summary: error instanceof Error ? error.message : String(error),
    };
  }
}
