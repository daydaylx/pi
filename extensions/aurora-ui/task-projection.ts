import type { WorkflowMode } from "../shared/workflow-mode.ts";
import { isPlanningMode, workflowModeLabel } from "../shared/workflow-mode.ts";
import type { AuroraUiState, AuroraVerificationSummary } from "./state.ts";
import {
  toolPresentation,
  type ActiveToolView,
  type SubagentInfo,
} from "./tool-renderers.ts";
import type { ReceiptAggregator } from "./receipts.ts";
import type {
  CurrentWorkViewModel,
  SubagentBranchInfo,
  TaskChangesSummary,
  TaskPhase,
  TaskViewModel,
  VerificationCheck,
  VerificationCriterion,
  VerificationViewModel,
} from "./task-view-model.ts";

export interface TaskProjectionContext {
  state: AuroraUiState;
  activeTools: ReadonlyMap<string, ActiveToolView>;
  subagents: readonly SubagentInfo[];
  receiptAggregator?: ReceiptAggregator;
  verificationStatus?: string | null;
  workspaceChangedSinceVerification?: boolean;
  currentPlan?: string;
  userPrompt?: string;
  contextPercent?: number | null;
  now?: number;
}

/**
 * Phase describes what is happening right now; verification describes how much
 * the workspace can be trusted (see 02-target-behavior.md phase rules).
 *
 * Precedence:
 * 1. Planning modes keep their explicit planning semantics.
 * 2. Only a real running verification tool claims "Prüfen".
 * 3. Active edit/bash/other work stays "Arbeiten" even after a failed check.
 * 4. Active thinking means "understand" unless planning mode applies.
 * 5. `done` requires idle plus a current successful verification — a stale one
 *    (workspace mutated since the check) never yields `done`.
 * 6. A failed check alone never claims that verification is currently running;
 *    only idle + failed may show it as an invitation to re-check.
 */
export interface TaskPhaseInput {
  mode: WorkflowMode;
  activityKind: AuroraUiState["activity"]["kind"];
  verificationStatus: string | null | undefined;
  hasActiveVerificationTool: boolean;
  verificationIsCurrent?: boolean;
}

export function determineTaskPhase({
  mode,
  activityKind,
  verificationStatus,
  hasActiveVerificationTool,
  verificationIsCurrent = true,
}: TaskPhaseInput): { phase: TaskPhase; label: string } {
  if (isPlanningMode(mode)) {
    if (activityKind === "thinking") {
      return { phase: "understand", label: "Verstehen" };
    }
    return { phase: "plan", label: workflowModeLabel(mode) };
  }

  if (hasActiveVerificationTool) {
    return { phase: "verify", label: "Prüfen" };
  }

  if (activityKind === "thinking") {
    return { phase: "understand", label: "Analysieren" };
  }

  if (activityKind === "tool" || activityKind === "responding") {
    return { phase: "work", label: "Arbeiten" };
  }

  if (activityKind === "idle") {
    if (verificationStatus === "verified" && verificationIsCurrent) {
      return { phase: "done", label: "Abgeschlossen" };
    }
    if (verificationStatus === "checks_failed") {
      return { phase: "verify", label: "Prüfen" };
    }
    return { phase: "work", label: "Bereit" };
  }

  return { phase: "work", label: "Arbeiten" };
}

export function extractTaskTitle(
  userPrompt?: string,
  currentPlan?: string,
  mode?: WorkflowMode,
): { title: string; goal?: string } {
  if (currentPlan) {
    const lines = currentPlan.split("\n");
    const heading = lines
      .find((line) => line.startsWith("# "))
      ?.replace(/^#\s*/, "")
      .trim();
    if (heading) {
      const goalLine = lines.find(
        (line) =>
          line.toLowerCase().includes("ziel:") ||
          line.toLowerCase().includes("goal:"),
      );
      return {
        title: heading,
        goal: goalLine
          ? goalLine.replace(/^[#*\s-]*ziel:\s*/i, "").trim()
          : undefined,
      };
    }
  }

  if (userPrompt) {
    const trimmed = userPrompt.trim().replace(/^[/#]\w+\s*/, "");
    const firstLine = trimmed.split("\n")[0]?.trim() ?? "";
    if (firstLine.length > 0) {
      return {
        title: firstLine.length > 60 ? `${firstLine.slice(0, 57)}…` : firstLine,
        goal:
          trimmed.length > firstLine.length
            ? trimmed.slice(firstLine.length).trim()
            : undefined,
      };
    }
  }

  return {
    title: isPlanningMode(mode ?? "work") ? "Planung" : "Aktuelle Aufgabe",
  };
}

function checksFromVerificationSummary(
  summary: AuroraVerificationSummary,
): VerificationCheck[] {
  const checks: VerificationCheck[] = summary.declaredRequiredIds.map((id) => {
    const outcome = summary.requiredOutcomes[id];
    const status: VerificationCheck["status"] =
      outcome === "success"
        ? "passed"
        : outcome === "failed"
          ? "failed"
          : outcome === "unavailable"
            ? "unavailable"
            : "pending";
    return { id, label: id, status };
  });
  for (const id of summary.blockingRecommendedIds) {
    checks.push({
      id,
      label: id,
      status: "failed",
      detail: "empfohlene Prüfung blockiert",
    });
  }
  return checks;
}

function criteriaFromChecks(
  checks: readonly VerificationCheck[],
): VerificationCriterion[] {
  return checks.map((check) => ({
    label: check.label,
    status:
      check.status === "passed"
        ? "passed"
        : check.status === "failed"
          ? "failed"
          : "pending",
    detail: check.detail,
  }));
}

/** Verdict from real, upstream-decided signals only — never recomputed from
 * raw outcomes, so Aurora cannot disagree with the one place
 * (`verificationStatus()` in setup-core) that is supposed to decide this. The
 * one exception is a defensive floor: "verified" without a single declared
 * required check is a contradiction, not evidence, so it is shown as
 * unverified rather than trusted at face value. */
function verdictFromSummary(
  summary: AuroraVerificationSummary,
  isStale: boolean,
): VerificationViewModel["verdict"] {
  if (isStale) return "UNVERIFIED";
  if (summary.status === "verified") {
    return summary.declaredRequiredIds.length > 0 ? "READY" : "UNVERIFIED";
  }
  if (summary.status === "checks_failed") return "NOT_READY";
  return "UNVERIFIED";
}

function projectVerificationFromSummary(
  summary: AuroraVerificationSummary,
  isStale: boolean,
): VerificationViewModel {
  const checks = checksFromVerificationSummary(summary);
  const failedOrUnavailable = checks.filter(
    (c) => c.status === "failed" || c.status === "unavailable",
  );

  return {
    verdict: verdictFromSummary(summary, isStale),
    criteria: criteriaFromChecks(checks),
    checks,
    evidence: failedOrUnavailable.map(
      (c) =>
        `${c.label}: ${c.status === "failed" ? "fehlgeschlagen" : "nicht verfügbar"}`,
    ),
    testsPassed: checks.filter((c) => c.status === "passed").length,
    testsTotal: summary.declaredRequiredIds.length,
    blockers: checks
      .filter((c) => c.status === "failed")
      .map((c) => `Pflichtprüfung "${c.label}" ist fehlgeschlagen.`),
  };
}

/** Coarse fallback for when no extension has published a structured
 * verification summary yet (untrusted project, verification status disabled,
 * or Aurora activated before the first `agent_settled`). Degrades to the
 * plain status string instead of showing nothing. */
function projectVerificationFallback(
  status: string | null | undefined,
  isStale: boolean,
): VerificationViewModel | undefined {
  if (!status && !isStale) return undefined;

  const normalized = status ? status.replace(/^Verify:\s*/, "") : null;
  const isVerified = normalized === "verified";
  const isFailed = normalized === "checks_failed";
  const verdict = isStale
    ? "UNVERIFIED"
    : isVerified
      ? "READY"
      : isFailed
        ? "NOT_READY"
        : "UNVERIFIED";

  return {
    verdict,
    criteria: [
      {
        label: "Änderungen implementiert",
        status: isVerified ? "passed" : "pending",
      },
      {
        label: "Tests & Prüfungen bestanden",
        status: isVerified ? "passed" : isFailed ? "failed" : "pending",
      },
    ],
    checks: [],
    evidence: [],
    blockers: isFailed
      ? ["Mindestens eine Verifikationsprüfung ist fehlgeschlagen."]
      : [],
  };
}

/** The one staleness definition for both verdict and phase: an earlier check
 * no longer describes the workspace once an edit ran or is running, or once
 * the caller recorded a mutation after the last completed check. */
export function verificationIsStale(
  activeTools: ReadonlyMap<string, ActiveToolView>,
  workspaceChangedSinceVerification: boolean,
): boolean {
  return (
    workspaceChangedSinceVerification ||
    [...activeTools.values()].some(
      (t) => t.kind === "verification" || t.kind === "edit",
    )
  );
}

export function projectVerificationState(
  status: string | null | undefined,
  activeTools: ReadonlyMap<string, ActiveToolView>,
  verificationSummary?: AuroraVerificationSummary | null,
  workspaceChangedSinceVerification = false,
): VerificationViewModel | undefined {
  const isStale = verificationIsStale(
    activeTools,
    workspaceChangedSinceVerification,
  );

  if (verificationSummary) {
    return projectVerificationFromSummary(verificationSummary, isStale);
  }

  return projectVerificationFallback(status, isStale);
}

export function projectCurrentWork(
  activeTools: ReadonlyMap<string, ActiveToolView>,
  now: number,
  changesSummary?: TaskChangesSummary,
): CurrentWorkViewModel | undefined {
  const tools = [...activeTools.values()];
  if (tools.length === 0) return undefined;

  const primary = tools[0]!;
  const elapsed = Math.max(0, Math.floor((now - primary.startedAt) / 1000));
  const category = primary.kind ?? "generic";
  const label = toolPresentation(primary.name).label;

  return {
    category,
    title: label,
    target: primary.target,
    summary: primary.target ? `${label}: ${primary.target}` : label,
    changingFiles:
      changesSummary && changesSummary.files.length > 0
        ? changesSummary.files.slice(0, 5)
        : undefined,
    elapsedSeconds: elapsed,
    tone: primary.tone,
  };
}

function branchStatusFromSubagentInfo(
  status: SubagentInfo["status"],
): SubagentBranchInfo["status"] {
  switch (status) {
    case "running":
      return "running";
    case "paused":
      return "paused";
    case "needs_attention":
      return "needs_attention";
    case "queued":
      return "queued";
  }
}

export function projectSubagentBranches(
  subagents: readonly SubagentInfo[],
): SubagentBranchInfo[] {
  return subagents.map((info) => ({
    agent: info.agent,
    role: info.label ?? info.agent,
    runId: info.runId,
    status: branchStatusFromSubagentInfo(info.status),
    focus: info.phase,
    progress: info.status === "running" ? "In Ausführung" : undefined,
  }));
}

export function projectTaskViewModel(
  context: TaskProjectionContext,
): TaskViewModel {
  const now = context.now ?? Date.now();
  const mode = (context.state.workflow.phase as WorkflowMode) ?? "work";
  const hasActiveVerification = [...context.activeTools.values()].some(
    (t) => t.kind === "verification",
  );
  // One staleness judgement feeds both the verdict and the phase, so they can
  // never disagree about whether the last check still applies.
  const stale = verificationIsStale(
    context.activeTools,
    context.workspaceChangedSinceVerification ?? false,
  );

  const { phase, label: phaseLabel } = determineTaskPhase({
    mode,
    activityKind: context.state.activity.kind,
    verificationStatus: context.verificationStatus,
    hasActiveVerificationTool: hasActiveVerification,
    verificationIsCurrent: !stale,
  });

  const { title, goal } = extractTaskTitle(
    context.userPrompt,
    context.currentPlan,
    mode,
  );

  const receipts = context.receiptAggregator
    ? context.receiptAggregator.getReceipts()
    : [];
  const subagents = projectSubagentBranches(context.subagents);
  const verification = projectVerificationState(
    context.verificationStatus,
    context.activeTools,
    context.state.verification,
    context.workspaceChangedSinceVerification,
  );
  const changesSummary = context.state.changes ?? undefined;
  const currentWork = projectCurrentWork(
    context.activeTools,
    now,
    changesSummary,
  );

  return {
    title,
    goal,
    phase,
    phaseLabel,
    workflowMode: mode,
    currentWork,
    findings: [],
    changesSummary,
    receipts,
    subagents,
    verification,
    contextPercent: context.contextPercent ?? null,
  };
}
