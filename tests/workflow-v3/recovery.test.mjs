/**
 * Wiederaufnahme: geänderte Pläne, korrupte Sidecars, konservativer Abgleich.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { assert, equal, test } from "./assertions.mjs";
import { quickPlan } from "../shared/plan-fixtures.mjs";
import { load } from "./harness.mjs";

const snapshotMod = await load("extensions/plan-mode/plan-snapshot.ts");
const store = await load("extensions/plan-mode/store/index.ts");

await test("changed plans and corrupt sidecars recover conservatively", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "pi-v3-recovery-"));
  try {
    const first = snapshotMod.finalizePlanDocument(
      quickPlan(),
      "simple_plan",
    );
    const initial = store.writePlanAndStateCAS(
      cwd,
      first.snapshot,
      "missing",
    );
    store.writeWorkflowStateCAS(
      cwd,
      {
        ...initial.state,
        status: "reviewing",
        reviewedPlanHash: first.snapshot.planHash,
      },
      initial.stateToken,
    );
    const changed = snapshotMod.finalizePlanDocument(
      quickPlan("Implementiere den geänderten Adapter"),
      "simple_plan",
      first.content,
    );
    writeFileSync(
      path.join(cwd, store.PLAN_RELATIVE_PATH),
      changed.content,
    );
    const invalidated = store.loadWorkflowStateV3(cwd);
    equal(
      invalidated.state.status,
      "planning",
      "plan change resets the workflow to planning",
    );
    equal(
      invalidated.state.reviewedPlanHash,
      undefined,
      "plan change invalidates the reviewed hash",
    );
    writeFileSync(
      path.join(cwd, store.WORKFLOW_STATE_RELATIVE_PATH),
      "{broken",
    );
    const corrupt = store.loadWorkflowStateV3(cwd);
    assert(
      corrupt.recovered &&
        corrupt.state.status === "planning" &&
        corrupt.state.completion === undefined,
      "corrupt sidecar is recovered as planning and never as success",
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
