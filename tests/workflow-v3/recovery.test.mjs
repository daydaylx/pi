/**
 * Wiederaufnahme: geänderte Pläne, korrupte Sidecars, konservativer Abgleich.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { assert, equal, test } from "./assertions.mjs";
import { quickPlan } from "../shared/plan-fixtures.mjs";
import { createHarness } from "../shared/harness.mjs";
import { load } from "./harness.mjs";

const snapshotMod = await load("extensions/plan-mode/plan-snapshot.ts");
const store = await load("extensions/plan-mode/store/index.ts");
const planMode = await load("extensions/plan-mode/index.ts");
const sessionMod = await load("extensions/plan-mode/session.ts");
const maintenance = await load("extensions/plan-mode/maintenance-commands.ts");

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

await test("interrupted paused workflows offer explicit recovery", async () => {
  if (!planMode || !snapshotMod || !store) return;
  const cwd = mkdtempSync(path.join(tmpdir(), "pi-v3-recovery-menu-"));
  try {
    const plan = snapshotMod.finalizePlanDocument(quickPlan(), "simple_plan");
    const initial = store.writePlanAndStateCAS(cwd, plan.snapshot, "missing");
    const paused = store.writeWorkflowStateCAS(
      cwd,
      {
        ...initial.state,
        status: "paused",
        steps: initial.state.steps.map((step, index) =>
          index === 0
            ? { ...step, status: "completed", evidence: "alter Nachweis" }
            : step,
        ),
      },
      initial.stateToken,
    );
    const harness = createHarness({
      confirm: true,
      select: (labels) =>
        labels.find(
          (label) => label === "Fortschritt zurücksetzen, Plan behalten",
        ),
    });
    planMode.default(harness.api);
    const context = harness.makeContext({ cwd });
    await harness.runHooks("session_start", {}, context);

    const reset = store.loadWorkflowStateV3(cwd);
    equal(reset.planContent, plan.content, "recovery reset retains the plan bytes");
    equal(reset.state.status, "planning", "recovery reset returns to planning");
    assert(
      reset.state.steps.every(
        (step) => step.status === "pending" && step.evidence === undefined,
      ),
      "recovery reset clears execution progress and evidence",
    );
    assert(
      harness.lifecycleCalls.some(
        (entry) => entry.kind === "confirm" && entry.title === "Fortschritt zurücksetzen?",
      ),
      "reset needs a second explicit confirmation",
    );
    equal(harness.sent.length, 0, "recovery never starts an agent turn implicitly");
    equal(paused.state.status, "paused", "fixture starts from a paused workflow");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

await test("recovery progress reset rejects a stale sidecar token", async () => {
  if (!snapshotMod || !store || !sessionMod || !maintenance) return;
  const cwd = mkdtempSync(path.join(tmpdir(), "pi-v3-recovery-stale-"));
  try {
    const plan = snapshotMod.finalizePlanDocument(quickPlan(), "simple_plan");
    const initial = store.writePlanAndStateCAS(cwd, plan.snapshot, "missing");
    const harness = createHarness({ confirm: true });
    const context = harness.makeContext({ cwd });
    const session = sessionMod.createWorkflowSession(harness.api);
    session.reload(context);
    store.writeWorkflowStateCAS(
      cwd,
      { ...initial.state, status: "paused" },
      initial.stateToken,
    );

    await maintenance.resetWorkflowProgress(session, context);
    const current = store.loadWorkflowStateV3(cwd);
    equal(current.planContent, plan.content, "a CAS conflict never removes the plan");
    equal(current.state.status, "paused", "a CAS conflict keeps newer sidecar state");
    assert(
      harness.notifications.some((entry) => entry.level === "error"),
      "the stale reset reports a visible error instead of overwriting state",
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
