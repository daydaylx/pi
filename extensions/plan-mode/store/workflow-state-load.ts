/**
 * Loading the plan and sidecar, including conservative recovery.
 *
 * Recovery never guesses in the optimistic direction: a changed plan hash
 * invalidates confirmation and review, an unreadable sidecar forces a fresh
 * confirmation, and a legacy v1/v2 state is reported rather than migrated.
 * Every one of those paths carries a warning the caller must surface.
 */
import { parsePlanSnapshot } from "../plan-snapshot.ts";
import {
  PLAN_RELATIVE_PATH,
  WORKFLOW_STATE_RELATIVE_PATH,
  isRecord,
  workflowPath,
} from "./paths.ts";
import { readBounded, tokenFor } from "./atomic-files.ts";
import {
  createWorkflowState,
  reconcileSteps,
} from "./workflow-state-factory.ts";
import { parseWorkflowStateV3 } from "./workflow-state-schema.ts";
import {
  MAX_PLAN_BYTES,
  MAX_STATE_BYTES,
  type LegacyState,
  type WorkflowStateLoadResult,
  type WorkflowStateV3,
} from "./types.ts";

function loadRawState(cwd: string): {
  raw?: string;
  parsed?: WorkflowStateV3;
  legacy?: LegacyState;
} {
  const statePath = workflowPath(cwd, WORKFLOW_STATE_RELATIVE_PATH);
  const raw = readBounded(cwd, statePath, MAX_STATE_BYTES);
  if (raw === undefined) return {};
  try {
    const value = JSON.parse(raw) as unknown;
    const parsed = parseWorkflowStateV3(value);
    if (parsed) return { raw, parsed };
    if (isRecord(value) && (value.version === 1 || value.version === 2)) {
      return { raw, legacy: value as LegacyState };
    }
    return { raw };
  } catch {
    return { raw };
  }
}

export function loadWorkflowStateV3(cwd: string): WorkflowStateLoadResult {
  const planPath = workflowPath(cwd, PLAN_RELATIVE_PATH);
  const planContent = readBounded(cwd, planPath, MAX_PLAN_BYTES);
  const rawState = loadRawState(cwd);
  const warnings: string[] = [];
  if (planContent === undefined) {
    if (rawState.raw !== undefined) {
      warnings.push(
        "Workflow-Sidecar ohne aktiven Plan bleibt zur manuellen Recovery erhalten.",
      );
    }
    return {
      stateToken: tokenFor(rawState.raw),
      recovered: false,
      migrationRequired: Boolean(rawState.legacy),
      warnings,
    };
  }
  if (rawState.legacy) {
    return {
      planContent,
      stateToken: tokenFor(rawState.raw),
      recovered: false,
      migrationRequired: true,
      warnings: [
        "Workflow-State v1/v2 muss vor weiterer Arbeit ausdrücklich nach v3 migriert werden.",
      ],
    };
  }
  const parsedPlan = parsePlanSnapshot(planContent);
  const snapshot = parsedPlan.snapshot;
  if (!snapshot) {
    warnings.push(
      ...parsedPlan.diagnostics.map((diagnostic) => diagnostic.message),
    );
    return {
      planContent,
      state: rawState.parsed,
      stateToken: tokenFor(rawState.raw),
      recovered: false,
      migrationRequired: false,
      warnings,
    };
  }
  if (!rawState.parsed) {
    if (rawState.raw !== undefined) {
      warnings.push(
        "Ungültiger v3-Sidecar wurde nicht als Erfolg interpretiert; der Plan benötigt erneute Bestätigung.",
      );
    }
    return {
      planContent,
      snapshot,
      state: createWorkflowState(snapshot),
      stateToken: tokenFor(rawState.raw),
      recovered: true,
      migrationRequired: false,
      warnings,
    };
  }
  const current = rawState.parsed;
  if (
    current.planId !== snapshot.planId ||
    current.planRevision !== snapshot.planRevision ||
    current.planHash !== snapshot.planHash
  ) {
    warnings.push(
      "Planrevision oder Plan-Hash hat sich geändert; Bestätigung und Review wurden invalidiert.",
    );
    return {
      planContent,
      snapshot,
      state: createWorkflowState(snapshot, current),
      stateToken: tokenFor(rawState.raw),
      recovered: true,
      migrationRequired: false,
      warnings,
    };
  }
  const reconciled = reconcileSteps(current, snapshot.steps);
  if (JSON.stringify(reconciled) !== JSON.stringify(current.steps)) {
    warnings.push(
      "Fortschritt wurde konservativ gegen die stabilen Step-IDs abgeglichen.",
    );
    return {
      planContent,
      snapshot,
      state: {
        ...current,
        revision: current.revision + 1,
        status: current.status === "done" ? "planning" : current.status,
        reviewedPlanHash: undefined,
        completion: undefined,
        steps: reconciled,
        updatedAt: new Date().toISOString(),
      },
      stateToken: tokenFor(rawState.raw),
      recovered: true,
      migrationRequired: false,
      warnings,
    };
  }
  return {
    planContent,
    snapshot,
    state: current,
    stateToken: tokenFor(rawState.raw),
    recovered: false,
    migrationRequired: false,
    warnings,
  };
}
