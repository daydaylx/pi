/** Archiving a completed workflow and discarding an active one. */
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { hashPlanSnapshotContent } from "../plan-snapshot.ts";
import {
  COMPLETION_REPORT_RELATIVE_PATH,
  PLAN_ARCHIVE_RELATIVE_DIR,
  PLAN_RELATIVE_PATH,
  WORKFLOW_STATE_RELATIVE_PATH,
  assertSafePath,
  workflowPath,
} from "./paths.ts";
import { readBounded, writeAtomic } from "./atomic-files.ts";
import { withWorkflowLock } from "./locks.ts";
import { currentStateToken } from "./workflow-state.ts";
import {
  MAX_PLAN_BYTES,
  MAX_STATE_BYTES,
  type CompletionReport,
  type WorkflowStateV3,
} from "./types.ts";

function archiveFileName(report: CompletionReport): string {
  const stamp = report.completedAt
    .replace(/[:.]/g, "-")
    .replace("T", "-")
    .replace("Z", "");
  return `${stamp}-${report.planId ?? report.directTaskId ?? report.completionId}-current-plan.md`;
}

export function archiveCompletedWorkflow(
  cwd: string,
  state: WorkflowStateV3,
  expectedToken: string,
  report: CompletionReport,
): string {
  if (state.status !== "done" || !state.completion) {
    throw new Error("Nur ein persistierter done-State darf archiviert werden.");
  }
  return withWorkflowLock(cwd, () => {
    if (currentStateToken(cwd) !== expectedToken) {
      throw new Error("Workflow-State hat sich vor der Archivierung geändert.");
    }
    const planPath = workflowPath(cwd, PLAN_RELATIVE_PATH);
    const plan = readBounded(cwd, planPath, MAX_PLAN_BYTES);
    if (!plan || hashPlanSnapshotContent(plan) !== state.planHash) {
      throw new Error("Aktiver Plan stimmt nicht mehr mit done überein.");
    }
    const archiveDir = workflowPath(cwd, PLAN_ARCHIVE_RELATIVE_DIR);
    mkdirSync(archiveDir, { recursive: true, mode: 0o700 });
    assertSafePath(cwd, archiveDir);
    const archivePath = join(archiveDir, archiveFileName(report));
    const reportBlock =
      `\n---\n\n## Abschlussbericht\n\n` +
      `- Completion-ID: \`${report.completionId}\`\n` +
      `- Plan-Hash: \`${state.planHash}\`\n` +
      `- Ergebnis: ${report.outcome}\n` +
      `- Reviewer: ${report.reviewerVerdict}\n` +
      `- Diff-Hash: \`${report.diffHash}\`\n` +
      (report.overrideReason
        ? `- Override-Begründung: ${report.overrideReason}\n`
        : "") +
      `\n### Prüfungen\n\n` +
      report.checks
        .map(
          (check) =>
            `- ${check.status.toUpperCase()} [${check.classification}] ${check.name}: ${check.summary}`,
        )
        .join("\n") +
      `\n\n### Reviewer-Zusammenfassung\n\n${report.reviewerSummary}\n`;
    const archivedContent = `${plan.trimEnd()}${reportBlock}`;
    if (existsSync(archivePath)) {
      const existing = readBounded(cwd, archivePath, MAX_STATE_BYTES);
      if (existing !== archivedContent) {
        throw new Error(
          "Vorhandenes Archiv mit gleicher Completion-ID weicht ab.",
        );
      }
    } else {
      writeAtomic(cwd, archivePath, archivedContent, MAX_STATE_BYTES);
    }
    unlinkSync(planPath);
    const statePath = workflowPath(cwd, WORKFLOW_STATE_RELATIVE_PATH);
    if (existsSync(statePath)) unlinkSync(statePath);
    const reportPath = workflowPath(cwd, COMPLETION_REPORT_RELATIVE_PATH);
    if (existsSync(reportPath)) unlinkSync(reportPath);
    return archivePath;
  });
}

export function discardActiveWorkflow(
  cwd: string,
  expectedToken: string,
  confirmed: boolean,
): void {
  if (!confirmed) throw new Error("Verwerfen wurde nicht bestätigt.");
  withWorkflowLock(cwd, () => {
    if (currentStateToken(cwd) !== expectedToken) {
      throw new Error("Workflow-State hat sich vor dem Verwerfen geändert.");
    }
    for (const relativePath of [
      PLAN_RELATIVE_PATH,
      WORKFLOW_STATE_RELATIVE_PATH,
      COMPLETION_REPORT_RELATIVE_PATH,
    ]) {
      const path = workflowPath(cwd, relativePath);
      if (existsSync(path)) unlinkSync(path);
    }
  });
}
