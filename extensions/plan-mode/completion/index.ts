/**
 * The completion pipeline: orchestration and public API.
 *
 * Every step lives in its own module; this file only decides the order and
 * hands results along. The order is part of the contract — evidence first,
 * then checks, then the independent reviewer, and finally the proof that
 * neither the checks nor the review changed the working tree.
 */
import { captureDiffEvidence, verifyDiffStability } from "./diff-evidence.ts";
import { runLspChecks, selectLspFiles } from "./lsp-check.ts";
import { buildReport } from "./report.ts";
import {
  buildReviewerInput,
  reviewerCheck,
  runReviewerCheck,
} from "./reviewer-check.ts";
import {
  classifyCompletionResult,
} from "./result-policy.ts";
import { evaluateScope } from "./scope-check.ts";
import { hardBoundaryCheck } from "./secret-boundary.ts";
import {
  runVerificationChecks,
  verificationCoverageCheck,
} from "./verification.ts";
import type {
  CompletionCheck,
  CompletionPipelineContext,
  CompletionPipelineResult,
} from "./types.ts";

export * from "./types.ts";
export {
  diagnoseCompletion,
  formatCompletionDiagnosis,
  type CompletionDiagnosis,
} from "./diagnosis.ts";
export { captureDiffEvidence, verifyDiffStability } from "./diff-evidence.ts";
export { formatCompletionResult } from "./formatter.ts";
export { selectLspFiles, runLspChecks } from "./lsp-check.ts";
export { buildReport, completionOverrideReport } from "./report.ts";
export {
  buildReviewerInput,
  parseCompletionReviewerResult,
  reviewerCheck,
  runReviewerCheck,
} from "./reviewer-check.ts";
export {
  canOverrideCompletion,
  classifyCompletionResult,
  type CompletionClassificationResult,
} from "./result-policy.ts";
export {
  deriveExpectedScope,
  evaluateScope,
  isInternalWorkflowArtifact,
} from "./scope-check.ts";
export { hardBoundaryCheck, isSecretPath } from "./secret-boundary.ts";
export {
  runSetupCheck,
  runVerificationChecks,
  touchesAgentRuntime,
  verificationCoverageCheck,
} from "./verification.ts";

/**
 * Plan steps must all be completed. A direct task has no step state, so the
 * check degrades to advisory rather than pretending the steps were verified.
 */
function stepsCheck(ctx: CompletionPipelineContext): CompletionCheck {
  if (!ctx.state) {
    return {
      name: "plan-steps",
      classification: ctx.directTask ? "advisory" : "required",
      status: ctx.directTask ? "pass" : "not_run",
      summary: ctx.directTask
        ? "Direktauftrag besitzt keinen Workflow-Step-State."
        : "Workflow-State fehlt.",
    };
  }
  const incomplete = ctx.state.steps.filter(
    (step) => step.status !== "completed",
  );
  return {
    name: "plan-steps",
    classification: "required",
    status: incomplete.length === 0 ? "pass" : "fail",
    summary:
      incomplete.length === 0
        ? "Alle stabilen Plan-Schritte sind abgeschlossen."
        : `${incomplete.length} Schritt(e) sind noch offen oder blockiert.`,
  };
}

/**
 * Run the pipeline. It reports a passed completion and nothing else — an
 * override is not a pipeline mode but a separate, justified decision made by
 * the caller via completionOverrideReport() on exactly this result.
 */
export async function runCompletionPipeline(
  ctx: CompletionPipelineContext,
): Promise<CompletionPipelineResult> {
  if (!ctx.plan && !ctx.directTask) {
    throw new Error("Completion benötigt PlanSnapshot oder Direktauftrag.");
  }
  if (ctx.plan && ctx.state) {
    if (
      ctx.state.planId !== ctx.plan.planId ||
      ctx.state.planRevision !== ctx.plan.planRevision ||
      ctx.state.planHash !== ctx.plan.planHash
    ) {
      throw new Error(
        "Workflow-State und PlanSnapshot gehören nicht zusammen.",
      );
    }
  }

  const evidence = await captureDiffEvidence(ctx.projectRoot, ctx.exec);
  const hardBoundary = hardBoundaryCheck(evidence.changedFiles);
  const checks: CompletionCheck[] = [
    stepsCheck(ctx),
    evidence.diffCheck,
    hardBoundary,
  ];

  const scope = evaluateScope(ctx, evidence.changedFiles);
  checks.push(...scope.checks);

  const verification = await runVerificationChecks(ctx);
  checks.push(...verification.checks);

  checks.push(
    ...(await runLspChecks(
      ctx,
      selectLspFiles(evidence.changedFiles.map((file) => file.path)),
    )),
  );

  // Evaluated before it is appended, so the coverage check never sees itself.
  checks.push(verificationCoverageCheck(ctx, checks));

  const reviewer = await runReviewerCheck(
    ctx,
    buildReviewerInput(ctx, evidence, hardBoundary, checks, scope.findings),
  );
  checks.push(reviewerCheck(reviewer));

  checks.push(
    await verifyDiffStability(ctx.projectRoot, ctx.exec, evidence.diffHash),
  );

  const aggregate = classifyCompletionResult(checks);
  const residualRisks = [
    ...evidence.warnings,
    ...verification.risks,
    ...aggregate.residualRisks,
  ];
  return {
    status: aggregate.status,
    checks,
    changedFiles: evidence.changedFiles,
    diffHash: evidence.diffHash,
    scopeFindings: scope.findings,
    residualRisks,
    reviewer,
    ...(aggregate.status === "pass"
      ? {
          report: buildReport(
            ctx,
            evidence,
            checks,
            scope.findings,
            residualRisks,
            reviewer,
          ),
        }
      : {}),
  };
}
