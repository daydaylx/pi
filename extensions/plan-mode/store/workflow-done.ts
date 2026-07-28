/**
 * The only path that may set status `done`.
 *
 * Everything here is a precondition, not a formality: a passed completion
 * needs every step completed, a reviewer PASS, all required proofs green and
 * no blocking check. An override needs a non-empty justification. Hard
 * secret/auth boundaries are not overridable at all (Umbauvertrag §13.2), so a
 * failing hard-boundaries check throws regardless of the claimed outcome.
 */
import { hashPlanSnapshotContent } from "../plan-snapshot.ts";
import {
  COMPLETION_REPORT_RELATIVE_PATH,
  PLAN_RELATIVE_PATH,
  workflowPath,
} from "./paths.ts";
import {
  readBounded,
  serialize,
  tokenFor,
  writeAtomic,
} from "./atomic-files.ts";
import { withWorkflowLock } from "./locks.ts";
import { currentStateToken, writeStateUnchecked } from "./workflow-state.ts";
import {
  MAX_PLAN_BYTES,
  MAX_STATE_BYTES,
  REQUIRED_PASS_CHECKS,
  type CompletionReport,
  type WorkflowCompletionState,
  type WorkflowStateV3,
} from "./types.ts";

export function commitWorkflowDone(
  cwd: string,
  state: WorkflowStateV3,
  expectedToken: string,
  report: CompletionReport,
): { state: WorkflowStateV3; stateToken: string } {
  if (state.status !== "reviewing") {
    throw new Error("Completion darf nur aus dem Status reviewing committen.");
  }
  if (
    report.outcome === "passed" &&
    state.steps.some((step) => step.status !== "completed")
  ) {
    throw new Error(
      "Ein bestandener Abschluss benötigt vollständig erledigte Schritte.",
    );
  }
  if (report.outcome === "passed" && report.reviewerVerdict !== "PASS") {
    throw new Error("Ein bestandener Abschluss benötigt Reviewer-PASS.");
  }
  if (report.outcome === "passed") {
    const checks = new Map(report.checks.map((check) => [check.name, check]));
    const missing = [...REQUIRED_PASS_CHECKS].filter(
      (name) => checks.get(name)?.status !== "pass",
    );
    if (missing.length > 0) {
      throw new Error(
        `Ein bestandener Abschluss benötigt erfolgreiche Pflichtnachweise: ${missing.join(", ")}.`,
      );
    }
    if (
      report.checks.some(
        (check) =>
          (check.classification === "required" && check.status !== "pass") ||
          (check.classification === "recommended" && check.status === "fail"),
      )
    ) {
      throw new Error(
        "Ein bestandener Abschluss enthält blockierende Prüfresultate.",
      );
    }
  }
  if (
    report.outcome === "override" &&
    (!report.overrideReason || report.overrideReason.trim() === "")
  ) {
    throw new Error("Ein Override benötigt eine Begründung.");
  }
  if (
    report.checks.find((check) => check.name === "hard-boundaries")?.status !==
    "pass"
  ) {
    throw new Error(
      "Harte Secret-/Auth-Grenzen können nicht übersteuert werden.",
    );
  }
  return withWorkflowLock(cwd, () => {
    if (currentStateToken(cwd) !== expectedToken) {
      throw new Error("Workflow-State hat sich vor done geändert.");
    }
    const plan = readBounded(
      cwd,
      workflowPath(cwd, PLAN_RELATIVE_PATH),
      MAX_PLAN_BYTES,
    );
    if (!plan || hashPlanSnapshotContent(plan) !== state.planHash) {
      throw new Error("Plan hat sich vor done geändert.");
    }
    if (
      report.planId !== state.planId ||
      report.planRevision !== state.planRevision ||
      report.planHash !== state.planHash
    ) {
      throw new Error(
        "Abschlussbericht gehört nicht zur aktiven Planrevision.",
      );
    }
    const completion: WorkflowCompletionState = {
      outcome: report.outcome,
      diffHash: report.diffHash,
      reviewerVerdict: report.reviewerVerdict,
      ...(report.overrideReason
        ? { overrideReason: report.overrideReason.trim() }
        : {}),
      completedAt: report.completedAt,
    };
    const next: WorkflowStateV3 = {
      ...state,
      revision: state.revision + 1,
      status: "done",
      activeStepId: undefined,
      reviewedPlanHash:
        report.reviewerVerdict === "PASS" ? state.planHash : undefined,
      completion,
      updatedAt: new Date().toISOString(),
    };
    writeAtomic(
      cwd,
      workflowPath(cwd, COMPLETION_REPORT_RELATIVE_PATH),
      serialize(report),
      MAX_STATE_BYTES,
    );
    writeStateUnchecked(cwd, next);
    return { state: next, stateToken: tokenFor(serialize(next)) };
  });
}
