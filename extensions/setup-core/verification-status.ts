import type { WorkspaceSnapshot } from "../../shared/workspace-snapshot.mjs";

export type VerificationStatus =
  | "clean"
  | "changed_unverified"
  | "verified"
  | "checks_failed"
  | "checks_unavailable";

export interface RequiredCheckRecord {
  profileIds: string[];
  result: "success" | "failed" | "unavailable";
  workspaceFingerprint: string;
  completedAt: string;
}

export interface VerificationLedger {
  lastRequiredCheck?: RequiredCheckRecord;
}

export interface CheckReport {
  classification: "required" | "recommended" | "advisory";
  status: string;
  exitCode: number | null;
  killed: boolean;
}

export function checkResultFromReports(
  reports: CheckReport[],
): RequiredCheckRecord["result"] | undefined {
  const required = reports.filter(
    (report) => report.classification === "required",
  );
  if (required.length === 0) return undefined;
  if (required.every((report) => report.status === "success"))
    return "success";
  if (
    required.some(
      (report) => report.killed || report.exitCode === null,
    )
  ) {
    return "unavailable";
  }
  return "failed";
}

export function verificationStatus(
  snapshot: WorkspaceSnapshot | undefined,
  ledger: VerificationLedger,
  requiredChecksAvailable = true,
): VerificationStatus {
  if (!snapshot) return "checks_unavailable";
  if (snapshot.changedFiles.length === 0) return "clean";
  if (!requiredChecksAvailable) return "checks_unavailable";
  const last = ledger.lastRequiredCheck;
  if (!last || last.workspaceFingerprint !== snapshot.fingerprint)
    return "changed_unverified";
  if (last.result === "success") return "verified";
  return last.result === "failed" ? "checks_failed" : "checks_unavailable";
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
