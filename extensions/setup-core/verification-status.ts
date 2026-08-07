/**
 * Technical verification status for the current workspace snapshot.
 *
 * One evaluator (`evaluateCheckRun`) is the single source of truth for both the
 * tool's blocking decision and the ledger. Two independent deciders over the
 * same question used to disagree: `project_check` blocked on a recommended
 * failure while the ledger ignored recommended reports entirely, so a run could
 * be an error and `verified` at the same time.
 *
 * `verified` means only this: every *declared* required profile ran
 * successfully against exactly this workspace fingerprint. It is never a proof
 * that the task itself is done.
 */
import type { WorkspaceSnapshot } from "../../shared/workspace-snapshot.mjs";

export type VerificationStatus =
  | "clean"
  | "changed_unverified"
  | "verified"
  | "checks_failed"
  | "checks_unavailable";

/** Outcome of one required profile's most recent run at a given fingerprint. */
export type RequiredOutcome = "success" | "failed" | "unavailable";

export interface RequiredCheckRecord {
  /** Checks from one workspace must never verify another. */
  workspaceRoot: string;
  workspaceFingerprint: string;
  /** required profile id → outcome of its most recent run at this fingerprint. */
  requiredOutcomes: Record<string, RequiredOutcome>;
  /** recommended profiles whose last run at this fingerprint blocked. */
  blockingRecommendedIds: string[];
  completedAt: string;
}

export interface VerificationLedger {
  lastRequiredCheck?: RequiredCheckRecord;
}

export interface CheckReport {
  profileId: string;
  classification: "required" | "recommended" | "advisory";
  /** success | failed | missing_binary | timeout | spawn_failed */
  status: string;
  exitCode: number | null;
  killed: boolean;
}

export interface CheckEvaluation {
  requiredOutcomes: Record<string, RequiredOutcome>;
  blockingRecommendedIds: string[];
  /** recommended profiles that ran without blocking — they clear a past block. */
  clearedRecommendedIds: string[];
  /** Declared required profiles covered by *this* run. */
  coveredRequiredIds: string[];
  /** Declared required profiles this run did not cover. */
  missingRequiredIds: string[];
  /** Whether the tool call itself must be reported as an error. */
  blocking: boolean;
}

export interface RequiredCoverage {
  covered: string[];
  missing: string[];
  total: number;
}

function outcomeOf(report: CheckReport): RequiredOutcome {
  if (report.status === "success") return "success";
  // No exit code means the check never produced a verdict — distinct from a
  // check that ran and said no.
  if (report.killed || report.exitCode === null) return "unavailable";
  return "failed";
}

/**
 * Reduce one `project_check` run against the set of required profiles the
 * project declares. The declared set — not the subset that happened to run —
 * is what decides coverage.
 */
export function evaluateCheckRun(
  reports: CheckReport[],
  declaredRequiredIds: string[],
): CheckEvaluation {
  const requiredOutcomes: Record<string, RequiredOutcome> = {};
  const blockingRecommendedIds: string[] = [];
  const clearedRecommendedIds: string[] = [];
  let blocking = false;

  for (const report of reports) {
    if (report.classification === "advisory") continue;
    if (report.classification === "required") {
      const outcome = outcomeOf(report);
      requiredOutcomes[report.profileId] = outcome;
      if (outcome !== "success") blocking = true;
      continue;
    }
    // recommended: a confirmed failure blocks; a missing tool stays a visible
    // residual risk and must not pretend the workspace is unverifiable.
    if (report.status === "success") {
      clearedRecommendedIds.push(report.profileId);
      continue;
    }
    if (report.status === "missing_binary") {
      // Residual risk only: it neither blocks nor clears. Clearing would let a
      // vanished binary erase a failure the same snapshot already confirmed,
      // turning checks_failed back into verified without anything being fixed.
      continue;
    }
    blockingRecommendedIds.push(report.profileId);
    blocking = true;
  }

  const declared = new Set(declaredRequiredIds);
  const coveredRequiredIds = declaredRequiredIds.filter(
    (id) => requiredOutcomes[id] === "success",
  );
  const missingRequiredIds = declaredRequiredIds.filter(
    (id) => requiredOutcomes[id] === undefined,
  );
  // A required profile that is no longer declared cannot contribute coverage.
  for (const id of Object.keys(requiredOutcomes)) {
    if (!declared.has(id)) delete requiredOutcomes[id];
  }

  return {
    requiredOutcomes,
    blockingRecommendedIds,
    clearedRecommendedIds,
    coveredRequiredIds,
    missingRequiredIds,
    blocking,
  };
}

/**
 * Fold a run into the ledger. Exactly one record is kept, bound to one
 * workspace root and one fingerprint; any change to either starts over, so
 * coverage can only ever accumulate across runs of a byte-identical workspace.
 */
export function mergeCheckRun(
  ledger: VerificationLedger,
  evaluation: CheckEvaluation,
  workspaceRoot: string,
  workspaceFingerprint: string,
): VerificationLedger {
  const previous = ledger.lastRequiredCheck;
  const carry =
    previous &&
    previous.workspaceRoot === workspaceRoot &&
    previous.workspaceFingerprint === workspaceFingerprint
      ? previous
      : undefined;

  const cleared = new Set(evaluation.clearedRecommendedIds);
  const blockingRecommendedIds = [
    ...new Set([
      ...(carry?.blockingRecommendedIds ?? []).filter((id) => !cleared.has(id)),
      ...evaluation.blockingRecommendedIds,
    ]),
  ].sort();

  return {
    lastRequiredCheck: {
      workspaceRoot,
      workspaceFingerprint,
      requiredOutcomes: {
        ...(carry?.requiredOutcomes ?? {}),
        ...evaluation.requiredOutcomes,
      },
      blockingRecommendedIds,
      completedAt: new Date().toISOString(),
    },
  };
}

/** Accumulated required coverage of a record, for reporting back to the agent. */
export function requiredCoverage(
  record: RequiredCheckRecord | undefined,
  declaredRequiredIds: string[],
): RequiredCoverage {
  const outcomes = record?.requiredOutcomes ?? {};
  return {
    covered: declaredRequiredIds.filter((id) => outcomes[id] === "success"),
    missing: declaredRequiredIds.filter((id) => outcomes[id] !== "success"),
    total: declaredRequiredIds.length,
  };
}

export interface VerificationStatusOptions {
  /** Every required profile the trusted project declares. Empty when untrusted. */
  declaredRequiredIds: string[];
  workspaceRoot: string;
}

export function verificationStatus(
  snapshot: WorkspaceSnapshot | undefined,
  ledger: VerificationLedger,
  options: VerificationStatusOptions,
): VerificationStatus {
  if (!snapshot) return "checks_unavailable";
  if (snapshot.changedFiles.length === 0) return "clean";

  const last = ledger.lastRequiredCheck;
  const current =
    last &&
    last.workspaceRoot === options.workspaceRoot &&
    last.workspaceFingerprint === snapshot.fingerprint
      ? last
      : undefined;
  const outcomes = Object.values(current?.requiredOutcomes ?? {});

  // A confirmed failure is reported before anything else can excuse it — a
  // check that ran and said no outranks both a check without a verdict and a
  // project that declares no required profile at all. Otherwise a blocking
  // tool result and the published status would disagree again.
  if (outcomes.includes("failed")) return "checks_failed";
  if ((current?.blockingRecommendedIds.length ?? 0) > 0) return "checks_failed";

  if (options.declaredRequiredIds.length === 0) return "checks_unavailable";
  if (!current) return "changed_unverified";
  if (outcomes.includes("unavailable")) return "checks_unavailable";
  if (
    options.declaredRequiredIds.every(
      (id) => current.requiredOutcomes[id] === "success",
    )
  ) {
    return "verified";
  }
  // Some required profile was never run for this snapshot.
  return "changed_unverified";
}

export function formatVerificationStatus(status: VerificationStatus): string {
  switch (status) {
    case "clean":
      return "Verify: clean";
    case "changed_unverified":
      return "Verify: changed_unverified";
    case "verified":
      return "Verify: verified";
    case "checks_failed":
      return "Verify: checks_failed";
    case "checks_unavailable":
      return "Verify: checks_unavailable";
  }
}
