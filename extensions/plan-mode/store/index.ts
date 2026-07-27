/**
 * Workflow persistence — public surface.
 *
 * Split by responsibility (Umbauvertrag §13.3, Arbeitspaket C):
 *   paths.ts          path constants, containment and symlink safety
 *   atomic-files.ts   bounded reads, atomic writes, serialization, tokens
 *   types.ts          state/report types, size limits, validation patterns
 *   locks.ts          the directory lock (no lease, no heartbeat)
 *   workflow-state.ts parsing, loading and CAS-guarded writes
 *   archive.ts        archiving a completed workflow, discarding an active one
 *   migration.ts      v1/v2 → v3, legacy support only
 *   direct-task.ts    plan-less direct tasks
 *
 * This barrel keeps the import surface unchanged for existing consumers.
 */

export {
  COMPLETION_REPORT_RELATIVE_PATH,
  DIRECT_TASK_RELATIVE_PATH,
  MIGRATION_BACKUP_RELATIVE_DIR,
  PLAN_ARCHIVE_RELATIVE_DIR,
  PLAN_RELATIVE_PATH,
  WORKFLOW_LOCK_RELATIVE_PATH,
  WORKFLOW_STATE_RELATIVE_PATH,
  assertSafePath,
  isPlanFilePath,
  workflowPath,
} from "./paths.ts";

export {
  WORKFLOW_STATE_VERSION,
  type CompletionReport,
  type DirectTask,
  type WorkflowCompletionState,
  type WorkflowLockHandle,
  type WorkflowStateLoadResult,
  type WorkflowStateV3,
  type WorkflowStatus,
  type WorkflowStepState,
  type WorkflowStepStatus,
} from "./types.ts";

export {
  acquireWorkflowLock,
  clearWorkflowLockAfterConfirmation,
  withWorkflowLock,
} from "./locks.ts";

export {
  commitWorkflowDone,
  createWorkflowState,
  finalizeObservedPlanCAS,
  loadWorkflowStateV3,
  parseWorkflowStateV3,
  writePlanAndStateCAS,
  writeWorkflowStateCAS,
} from "./workflow-state.ts";

export { archiveCompletedWorkflow, discardActiveWorkflow } from "./archive.ts";

export { migrateLegacyWorkflowToV3 } from "./migration.ts";

export {
  clearDirectTask,
  loadDirectTask,
  parseDirectTask,
  saveDirectTask,
} from "./direct-task.ts";
