/**
 * P1 regression coverage: finalizePlanning mode/state, discard-plan
 * permissions, and single executionPrompt handoff after /work.
 *
 * These guard fixes already landed in production. Do not soften assertions
 * to accept both old and new semantics — that would let the regression back
 * in unnoticed.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { assert, equal, test } from "./assertions.mjs";
import { createHarness, latestStatus } from "../shared/harness.mjs";
import { quickPlan } from "../shared/plan-fixtures.mjs";
import { load } from "./harness.mjs";

const planMode = await load("extensions/plan-mode/index.ts");
const modePermissions = await load("extensions/mode-permissions.ts");
const store = await load("extensions/plan-mode/store/index.ts");
const capsMod = await load("extensions/shared/workflow-capabilities.ts");
const snapshotMod = await load("extensions/plan-mode/plan-snapshot.ts");

function queryCapabilities(api) {
  return capsMod.requestWorkflowCapabilities(api.events);
}

function messageContent(value) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  if (typeof value.content === "string") return value.content;
  if (typeof value.message?.content === "string") return value.message.content;
  return "";
}

function joinAgentContext(sent, hookResults) {
  const parts = [];
  for (const entry of sent ?? []) {
    parts.push(messageContent(entry?.message ?? entry));
  }
  for (const entry of hookResults ?? []) {
    parts.push(messageContent(entry?.message ?? entry));
  }
  return parts.filter(Boolean).join("\n\n---\n\n");
}

function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let count = 0;
  let index = 0;
  while ((index = haystack.indexOf(needle, index)) !== -1) {
    count += 1;
    index += needle.length;
  }
  return count;
}

function activatedModes(harness, fromIndex = 0) {
  return harness.emitted
    .slice(fromIndex)
    .filter((entry) => entry.name === "workflow-capabilities:activated")
    .map((entry) => entry.event?.mode);
}

async function writeQuickPlan(cwd) {
  mkdirSync(path.join(cwd, ".agent", "plans"), { recursive: true });
  const content = quickPlan();
  writeFileSync(path.join(cwd, store.PLAN_RELATIVE_PATH), content);
  return content;
}

function seedWorkingPlan(cwd) {
  const finalized = snapshotMod.finalizePlanDocument(
    quickPlan(),
    "simple_plan",
  );
  const initial = store.writePlanAndStateCAS(
    cwd,
    finalized.snapshot,
    "missing",
  );
  return store.writeWorkflowStateCAS(
    cwd,
    {
      ...initial.state,
      status: "working",
    },
    initial.stateToken,
  );
}

await test("--plan uses the same confirmation guard as /plan architecture", async () => {
  if (!planMode) return;
  const cwd = mkdtempSync(path.join(tmpdir(), "pi-v3-plan-flag-"));
  try {
    const saved = seedWorkingPlan(cwd);
    const harness = createHarness({
      confirm: false,
      flags: { plan: true },
    });
    planMode.default(harness.api);
    const context = harness.makeContext({ cwd, trusted: true, mode: "tui" });

    await harness.runHooks("session_start", {}, context);

    assert(
      harness.lifecycleCalls.some(
        (entry) =>
          entry.kind === "confirm" &&
          entry.title === "Aktiven Plan überarbeiten?",
      ),
      "--plan asks before revising an active plan",
    );
    const loaded = store.loadWorkflowStateV3(cwd);
    equal(
      loaded.snapshot?.planId,
      saved.state.planId,
      "declining preserves plan identity",
    );
    equal(
      loaded.state?.status,
      "working",
      "declining preserves execution state",
    );
    const contexts = await harness.runHooks("before_agent_start", {}, context);
    assert(
      contexts.some((entry) =>
        entry?.message?.content?.includes("PI WORKFLOW: AUSFÜHRUNG"),
      ),
      "declining --plan keeps the active work context instead of injecting planning",
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

await test("review-plan rejects a plan whose execution has started", async () => {
  if (!planMode) return;
  const cwd = mkdtempSync(path.join(tmpdir(), "pi-v3-review-state-"));
  try {
    seedWorkingPlan(cwd);
    const harness = createHarness({ confirm: true });
    planMode.default(harness.api);
    const context = harness.makeContext({ cwd, trusted: true, mode: "tui" });
    await harness.runHooks("session_start", {}, context);
    const sentBeforeReview = harness.sent.length;

    await harness.commands.get("review-plan")("", context);

    equal(
      harness.sent.length,
      sentBeforeReview,
      "review-plan does not start a review turn after work began",
    );
    const caps = queryCapabilities(harness.api);
    equal(caps.state, "working", "working sidecar state remains authoritative");
    equal(caps.mode, "work", "working plans retain the work capability mode");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

await test("planning changes publish an Aurora workflow patch", async () => {
  if (!planMode) return;
  const cwd = mkdtempSync(path.join(tmpdir(), "pi-v3-aurora-plan-"));
  try {
    const harness = createHarness({ confirm: true });
    planMode.default(harness.api);
    const context = harness.makeContext({ cwd, trusted: true, mode: "tui" });
    await harness.runHooks("session_start", {}, context);
    harness.api.events.emit("aurora-ui/state/request", {
      type: "request",
      requestId: "workflow-test",
      sessionEpoch: "workflow-epoch",
      requester: "test",
    });
    const emittedBeforePlanning = harness.emitted.length;

    await harness.commands.get("plan")("quick", context);

    assert(
      harness.emitted
        .slice(emittedBeforePlanning)
        .some(
          (entry) =>
            entry.name === "aurora-ui/state/patch" &&
            entry.event?.patch?.workflow?.phase === "planning",
        ),
      "the plan activation publishes the planning phase to Aurora",
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

await test("finalizePlanning keeps capabilities consistent before /work", async () => {
  if (!planMode || !modePermissions) return;
  const cwd = mkdtempSync(path.join(tmpdir(), "pi-v3-p1-finalize-"));
  try {
    const harness = createHarness({ confirm: true });
    planMode.default(harness.api);
    modePermissions.default(harness.api);
    const context = harness.makeContext({
      cwd,
      trusted: true,
      mode: "tui",
    });
    await harness.runHooks("session_start", {}, context);
    await harness.commands.get("plan")("quick", context);
    await writeQuickPlan(cwd);

    const emittedBeforeSettle = harness.emitted.length;
    await harness.runHooks("agent_settled", {}, context);

    const loaded = store.loadWorkflowStateV3(cwd);
    equal(
      loaded.state?.status,
      "planning",
      "sidecar remains planning until explicit /work",
    );
    assert(
      Boolean(loaded.snapshot),
      "finalizePlanning produces a PlanSnapshot",
    );

    // No dedicated `ready` WorkflowStatus exists today
    // (idle|planning|working|reviewing|paused|blocked|done). Desired
    // post-finalize semantics until /work: capabilities must stay consistent
    // with the unfinished plan (planning + plan mode), never planning+work,
    // and must not arm work permissions.
    const caps = queryCapabilities(harness.api);
    assert(
      !(caps.state === "planning" && caps.mode === "work"),
      "capabilities must not report state planning with mode work after finalizePlanning",
    );
    assert(
      caps.mode === "simple_plan" || caps.mode === "detailed_plan",
      "finished plan before /work must keep a plan mode, not work",
    );
    assert(
      !activatedModes(harness, emittedBeforeSettle).includes("work"),
      "finalizePlanning must not publish a work activation",
    );

    const sourceWrite = await harness.runHooks(
      "tool_call",
      { toolName: "edit", input: { path: "src/app.ts" } },
      context,
    );
    assert(
      sourceWrite.some((result) => result?.block === true),
      "project edits stay blocked until explicit /work",
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

await test("discard-plan restores work default permissions", async () => {
  if (!planMode || !modePermissions) return;
  const cwd = mkdtempSync(path.join(tmpdir(), "pi-v3-p1-discard-"));
  try {
    const harness = createHarness({ confirm: true });
    planMode.default(harness.api);
    modePermissions.default(harness.api);
    const context = harness.makeContext({
      cwd,
      trusted: true,
      mode: "tui",
    });
    await harness.runHooks("session_start", {}, context);
    equal(
      latestStatus(harness, "permissions"),
      "🛡 DEFAULT · PROJECT WRITE",
      "work default starts as project-write",
    );

    await harness.commands.get("plan")("quick", context);
    assert(
      String(latestStatus(harness, "permissions") ?? "").includes("READONLY"),
      "planning activation switches effective permissions to readonly",
    );
    await writeQuickPlan(cwd);

    const emittedBeforeDiscard = harness.emitted.length;
    await harness.commands.get("discard-plan")("", context);

    const caps = queryCapabilities(harness.api);
    equal(caps.mode, "work", "discard-plan restores workflow mode work");
    equal(caps.state, "idle", "discard-plan restores workflow state idle");
    equal(
      latestStatus(harness, "permissions"),
      "🛡 DEFAULT · PROJECT WRITE",
      "effective permissions return to the work default project-write",
    );
    assert(
      activatedModes(harness, emittedBeforeDiscard).includes("work"),
      "discard-plan publishes workflow-capabilities:activated for work",
    );

    const sourceWrite = await harness.runHooks(
      "tool_call",
      { toolName: "edit", input: { path: "src/app.ts" } },
      context,
    );
    assert(
      sourceWrite.every((result) => result?.block !== true),
      "project edits are allowed again under the restored work default",
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

await test("executionPrompt appears exactly once in final agent context", async () => {
  if (!planMode) return;
  const cwd = mkdtempSync(path.join(tmpdir(), "pi-v3-p1-handoff-"));
  try {
    const harness = createHarness({ confirm: true });
    planMode.default(harness.api);
    const context = harness.makeContext({
      cwd,
      trusted: true,
      mode: "tui",
    });
    await harness.runHooks("session_start", {}, context);
    await harness.commands.get("plan")("quick", context);
    const planMarkdown = await writeQuickPlan(cwd);
    await harness.runHooks("agent_settled", {}, context);

    const sentBeforeWork = harness.sent.length;
    await harness.commands.get("work")("", context);
    const injects = await harness.runHooks("before_agent_start", {}, context);

    const finalContext = joinAgentContext(
      harness.sent.slice(sentBeforeWork),
      injects,
    );
    equal(
      countOccurrences(finalContext, "[PI WORKFLOW: AUSFÜHRUNG]"),
      1,
      "final agent context contains [PI WORKFLOW: AUSFÜHRUNG] exactly once",
    );

    const loaded = store.loadWorkflowStateV3(cwd);
    const planBody = loaded.snapshot?.content ?? planMarkdown;
    equal(
      countOccurrences(finalContext, planBody),
      1,
      "full plan markdown appears exactly once in the final agent context",
    );

    for (const step of loaded.snapshot?.steps ?? []) {
      equal(
        countOccurrences(finalContext, `Step-ID: ${step.id}`),
        1,
        `step ${step.id} appears only once in the single execution context`,
      );
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
