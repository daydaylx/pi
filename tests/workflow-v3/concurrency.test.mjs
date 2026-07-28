/**
 * CAS, State-Token, Archivierungslock und Locks ohne implizites Timeout.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { assert, equal, test } from "./assertions.mjs";
import { quickPlan } from "../shared/plan-fixtures.mjs";
import { load } from "./harness.mjs";

const snapshotMod = await load("extensions/plan-mode/plan-snapshot.ts");
const store = await load("extensions/plan-mode/store/index.ts");
const execution = await load("extensions/plan-mode/execution.ts");

await test("sidecar CAS, immutable plan and deterministic archive", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "pi-v3-store-"));
  try {
    const finalized = snapshotMod.finalizePlanDocument(
      quickPlan(),
      "simple_plan",
    );
    const initial = store.writePlanAndStateCAS(
      cwd,
      finalized.snapshot,
      "missing",
    );
    equal(initial.state.status, "planning", "new state starts in planning");
    let state = execution.startOrResumeExecution(initial.state);
    const paused = execution.pauseExecution({
      ...state,
      activeStepId: finalized.snapshot.steps[0].id,
      steps: state.steps.map((step, index) =>
        index === 0 ? { ...step, status: "in_progress" } : step,
      ),
    });
    equal(paused.status, "paused", "explicit pause persists a resumable state");
    assert(
      paused.activeStepId === undefined &&
        paused.steps.every((step) => step.status !== "in_progress"),
      "pause clears transient step ownership without a heartbeat",
    );
    state = execution.startOrResumeExecution(paused);
    let saved = store.writeWorkflowStateCAS(
      cwd,
      state,
      initial.stateToken,
    );
    equal(saved.state.status, "working", "explicit work starts execution");
    for (const step of finalized.snapshot.steps) {
      state = execution.updateExecutionStep(saved.state, {
        stepId: step.id,
        status: "completed",
        evidence: "unit test passed",
      }).state;
      saved = store.writeWorkflowStateCAS(cwd, state, saved.stateToken);
    }
    equal(saved.state.status, "reviewing", "last completed step enters review");
    assert(
      !readFileSync(
        path.join(cwd, store.PLAN_RELATIVE_PATH),
        "utf8",
      ).includes("[x]"),
      "progress never mutates plan markdown",
    );
    let conflicted = false;
    try {
      store.writeWorkflowStateCAS(cwd, saved.state, initial.stateToken);
    } catch {
      conflicted = true;
    }
    assert(conflicted, "stale state token is rejected");
    const report = {
      version: 1,
      completionId: "completion-test",
      planId: finalized.snapshot.planId,
      planRevision: finalized.snapshot.planRevision,
      planHash: finalized.snapshot.planHash,
      diffHash: "a".repeat(64),
      outcome: "passed",
      reviewerVerdict: "PASS",
      checks: [
        "plan-steps",
        "git-diff-check",
        "hard-boundaries",
        "technical-scope",
        "declared-verification",
        "independent-reviewer",
        "diff-stability",
      ].map((name) => ({
        name,
        classification: "required",
        status: "pass",
        summary: "passed",
      })),
      scopeFindings: [],
      residualRisks: [],
      reviewerSummary: "Keine Befunde.",
      completedAt: "2026-07-27T12:00:00.000Z",
    };
    let forgedPassRejected = false;
    try {
      store.commitWorkflowDone(
        cwd,
        saved.state,
        saved.stateToken,
        { ...report, checks: [] },
      );
    } catch {
      forgedPassRejected = true;
    }
    assert(
      forgedPassRejected,
      "store rejects a forged PASS report without completion evidence",
    );
    const done = store.commitWorkflowDone(
      cwd,
      saved.state,
      saved.stateToken,
      report,
    );
    equal(done.state.status, "done", "only completion commit creates done");
    const archive = store.archiveCompletedWorkflow(
      cwd,
      done.state,
      done.stateToken,
      report,
    );
    assert(existsSync(archive), "completion archive exists");
    assert(
      !existsSync(path.join(cwd, store.PLAN_RELATIVE_PATH)) &&
        !existsSync(path.join(cwd, store.WORKFLOW_STATE_RELATIVE_PATH)),
      "active plan and sidecar are removed after archive",
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

await test("live legacy lease and occupied v3 lock never time out implicitly", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "pi-v3-lock-"));
  try {
    mkdirSync(path.join(cwd, ".agent", "plans"), { recursive: true });
    writeFileSync(path.join(cwd, store.PLAN_RELATIVE_PATH), quickPlan());
    writeFileSync(
      path.join(cwd, store.WORKFLOW_STATE_RELATIVE_PATH),
      JSON.stringify({
        version: 2,
        execution: {
          ownerId: "other-session",
          leaseExpiresAt: "2099-01-01T00:00:00.000Z",
        },
      }),
    );
    let liveLeaseBlocked = false;
    try {
      store.migrateLegacyWorkflowToV3(cwd, {
        confirmedLegacySessionsClosed: true,
        now: new Date("2026-07-27T10:00:00.000Z"),
      });
    } catch {
      liveLeaseBlocked = true;
    }
    assert(liveLeaseBlocked, "live v2 lease blocks migration");
    rmSync(path.join(cwd, store.WORKFLOW_STATE_RELATIVE_PATH));
    const lock = store.acquireWorkflowLock(cwd);
    let secondBlocked = false;
    try {
      store.acquireWorkflowLock(cwd);
    } catch {
      secondBlocked = true;
    }
    assert(secondBlocked, "occupied v3 lock is never stolen by elapsed time");
    lock.release();
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
