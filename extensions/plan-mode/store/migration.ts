/**
 * Legacy migration support only.
 * Not part of the active workflow-v3 runtime.
 *
 * v1/v2 sidecars are never migrated silently: /migrate-plan requires the user
 * to confirm that older sessions are closed, refuses while a v2 execution
 * lease is still live, and always writes a backup first (Umbauvertrag §13.5).
 */
import { randomUUID } from "node:crypto";
import { copyFileSync, mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import {
  ensurePlanStepIds,
  extractPlanSnapshotSteps,
  hashPlanSnapshotContent,
  parsePlanSnapshot,
  stampPlanSnapshotMetadata,
  type PlanKind,
  type PlanSnapshotMetadata,
} from "../plan-snapshot.ts";
import {
  MIGRATION_BACKUP_RELATIVE_DIR,
  PLAN_RELATIVE_PATH,
  WORKFLOW_STATE_RELATIVE_PATH,
  isRecord,
  workflowPath,
} from "./paths.ts";
import { readBounded, serialize, tokenFor, writeAtomic } from "./atomic-files.ts";
import { withWorkflowLock } from "./locks.ts";
import { writeStateUnchecked } from "./workflow-state.ts";
import {
  MAX_PLAN_BYTES,
  MAX_STATE_BYTES,
  UUID_PATTERN,
  type LegacyState,
  type WorkflowStateLoadResult,
  type WorkflowStateV3,
  type WorkflowStatus,
  type WorkflowStepState,
} from "./types.ts";

function legacyPlanType(legacy: LegacyState, content: string): PlanKind {
  if (
    legacy.planType === "detailed_plan" ||
    legacy.planType === "simple_plan"
  ) {
    return legacy.planType;
  }
  return /##\s+(?:\d+\.\s*)?(?:Nicht-Ziele|Betroffene Bereiche|Tests \/ Checks)/i.test(
    content,
  )
    ? "detailed_plan"
    : "simple_plan";
}

function legacyStatus(legacy: LegacyState): WorkflowStatus {
  const value = legacy.lifecycle ?? legacy.phase;
  if (value === "blocked") return "blocked";
  if (value === "executing" || value === "paused" || value === "ready") {
    return "paused";
  }
  return "planning";
}

function hasLiveLegacyLease(legacy: LegacyState, now: Date): boolean {
  const expires = legacy.execution?.leaseExpiresAt;
  return (
    typeof legacy.execution?.ownerId === "string" &&
    typeof expires === "string" &&
    Number.isFinite(Date.parse(expires)) &&
    Date.parse(expires) > now.getTime()
  );
}

function migrationBackupDir(cwd: string, now: Date): string {
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  return workflowPath(cwd, join(MIGRATION_BACKUP_RELATIVE_DIR, stamp));
}

export function migrateLegacyWorkflowToV3(
  cwd: string,
  options: {
    confirmedLegacySessionsClosed: boolean;
    now?: Date;
  },
): WorkflowStateLoadResult {
  if (!options.confirmedLegacySessionsClosed) {
    throw new Error(
      "Migration benötigt die Bestätigung, dass ältere Pi-Sessions geschlossen sind.",
    );
  }
  const now = options.now ?? new Date();
  return withWorkflowLock(cwd, () => {
    const planPath = workflowPath(cwd, PLAN_RELATIVE_PATH);
    const statePath = workflowPath(cwd, WORKFLOW_STATE_RELATIVE_PATH);
    const plan = readBounded(cwd, planPath, MAX_PLAN_BYTES);
    const stateRaw = readBounded(cwd, statePath, MAX_STATE_BYTES);
    if (!plan || !stateRaw) {
      throw new Error("Legacy-Plan oder -Sidecar fehlt.");
    }
    let legacy: LegacyState;
    try {
      const parsed = JSON.parse(stateRaw) as unknown;
      if (!isRecord(parsed) || (parsed.version !== 1 && parsed.version !== 2)) {
        throw new Error("Kein migrierbarer v1/v2-State.");
      }
      legacy = parsed as LegacyState;
    } catch (error) {
      throw new Error(
        `Legacy-State ist nicht sicher migrierbar: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (hasLiveLegacyLease(legacy, now)) {
      throw new Error(
        "Eine aktive v2-Execution-Lease blockiert die Migration.",
      );
    }
    const backupDir = migrationBackupDir(cwd, now);
    mkdirSync(backupDir, { recursive: true, mode: 0o700 });
    copyFileSync(planPath, join(backupDir, basename(planPath)));
    copyFileSync(statePath, join(backupDir, basename(statePath)));

    const planType = legacyPlanType(legacy, plan);
    const withIds = ensurePlanStepIds(plan);
    const metadata: PlanSnapshotMetadata = {
      version: 3,
      planId:
        typeof legacy.planId === "string" && UUID_PATTERN.test(legacy.planId)
          ? legacy.planId
          : randomUUID(),
      planRevision: 1,
      planType,
    };
    const migratedPlan = stampPlanSnapshotMetadata(withIds, metadata);
    const steps = extractPlanSnapshotSteps(migratedPlan);
    const progress = Array.isArray(legacy.progress) ? legacy.progress : [];
    const stepStates = steps.map((step, index): WorkflowStepState => {
      const record = progress.find(
        (candidate: Record<string, unknown>) =>
        Number(candidate.step) === index + 1,
      );
      const status =
        record?.status === "completed"
          ? "completed"
          : record?.status === "blocked"
            ? "blocked"
            : "pending";
      return {
        id: step.id,
        status,
        ...(typeof record?.evidence === "string" && record.evidence.trim()
          ? { evidence: record.evidence.trim() }
          : {}),
      };
    });
    const state: WorkflowStateV3 = {
      version: 3,
      revision: 1,
      planId: metadata.planId,
      planRevision: metadata.planRevision,
      planHash: hashPlanSnapshotContent(migratedPlan),
      status: legacyStatus(legacy),
      steps: stepStates,
      updatedAt: now.toISOString(),
    };
    writeAtomic(cwd, planPath, migratedPlan, MAX_PLAN_BYTES);
    writeStateUnchecked(cwd, state);
    const parsed = parsePlanSnapshot(migratedPlan);
    return {
      planContent: migratedPlan,
      snapshot: parsed.snapshot,
      state,
      stateToken: tokenFor(serialize(state)),
      recovered: true,
      migrationRequired: false,
      warnings: parsed.snapshot
        ? ["Workflow-State wurde konservativ von v1/v2 nach v3 migriert."]
        : [
            "Workflow-State wurde nach v3 migriert; der Legacy-Plan bleibt in planning, bis fehlende v3-Vertragsabschnitte ergänzt wurden.",
            ...parsed.diagnostics.map((diagnostic) => diagnostic.message),
          ],
    };
  });
}
