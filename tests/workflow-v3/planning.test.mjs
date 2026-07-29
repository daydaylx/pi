/**
 * Planung: /plan, Planarten, Statuslabel und Abbruchschutz vor Archivierung.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { assert, eq, test } from "./assertions.mjs";
import { createHarness, latestStatus, assertNoGlobalChrome } from "../shared/harness.mjs";
import { validPlan, planUtils, v3Plan } from "../shared/plan-fixtures.mjs";
import { load } from "./harness.mjs";

const planMode = await load("extensions/plan-mode/index.ts");
const modePermissions = await load("extensions/mode-permissions.ts");
const controlPlane = await load("extensions/control-plane.ts");
const planSnapshot = await load("extensions/plan-mode/plan-snapshot.ts");
const planStore = await load("extensions/plan-mode/store/index.ts");

await test("plan workflow lifecycle", async () => {
  if (!planMode || !planUtils) return;
  const cwd = mkdtempSync(path.join(tmpdir(), "pi-plan-status-"));
  const emptyCwd = mkdtempSync(path.join(tmpdir(), "pi-plan-empty-"));
  try {
    planUtils.writePlanFileAtomic(cwd, validPlan);
    let modeLabels = [];
    const harness = createHarness({
      select: (labels) => {
        modeLabels = labels;
        return labels.includes("Schnellplan") ? "Schnellplan" : undefined;
      },
    });
    planMode.default(harness.api);
    if (controlPlane) controlPlane.default(harness.api);
    // mode-permissions owns the thinking level (it also holds the manual
    // override), so the pair has to be loaded like the real runtime does.
    if (modePermissions) modePermissions.default(harness.api);
    const context = harness.makeContext({ cwd });
    // The direct Shift+Tab handler owns mode changes since Phase 2. Force the
    // shared menu's plain-select fallback so this test follows that current
    // route instead of reviving the removed workflow-event round trip.
    context.ui.custom = async () => {
      throw new Error("use deterministic select fallback");
    };
    await harness.runHooks("session_start", {}, context);
    eq(
      latestStatus(harness, "workflow"),
      "ARBEIT",
      "an existing plan restored in work mode is stored but not executing",
    );
    const openModeMenu = harness.shortcuts.get("shift+tab");
    assert(Boolean(openModeMenu), "Shift+Tab registers the direct mode menu");
    const sentBeforeModeSelection = harness.sent.length;
    if (openModeMenu) await openModeMenu(context);
    assert(
      !modeLabels.includes("Skill-Modus"),
      "Shift+Tab no longer offers the retired Skill-Modus entry",
    );
    eq(
      latestStatus(harness, "workflow"),
      "PLANUNG",
      "direct mode menu keeps planning status compact",
    );
    eq(
      harness.api.getThinkingLevel(),
      "medium",
      "direct mode menu applies the selected mode defaults",
    );
    eq(
      harness.sent.length,
      sentBeforeModeSelection,
      "Shift+Tab selects a plan mode without starting an agent turn",
    );
    const selectedPlanContext = await harness.runHooks(
      "before_agent_start",
      {},
      context,
    );
    assert(
      selectedPlanContext.some((entry) =>
        entry?.message?.content?.includes("PI WORKFLOW: PLANUNG"),
      ),
      "the next user turn receives the selected planning context",
    );
    await harness.runHooks("session_shutdown", {}, context);
    eq(
      latestStatus(harness, "workflow"),
      undefined,
      "workflow clears on shutdown",
    );
    const nextContext = harness.makeContext({ cwd: emptyCwd });
    await harness.runHooks("session_start", {}, nextContext);
    eq(
      latestStatus(harness, "workflow"),
      "ARBEIT",
      "a new empty session resets inherited in-memory plan state",
    );
    const sentBeforeEmptyWork = harness.sent.length;
    await harness.commands.get("work")("", nextContext);
    eq(
      harness.sent.length,
      sentBeforeEmptyWork,
      "/work without a plan does not trigger an execution turn",
    );
    eq(
      latestStatus(harness, "workflow"),
      "ARBEIT",
      "/work without a plan remains ordinary work mode",
    );
    assertNoGlobalChrome(
      harness,
      "plan mode installs no permanent widget or chrome",
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(emptyCwd, { recursive: true, force: true });
  }
});

await test("workflow menus keep planning passive and block plan work without a plan", async () => {
  if (!planMode || !controlPlane) return;
  const cwd = mkdtempSync(path.join(tmpdir(), "pi-passive-mode-menu-"));
  try {
    let choice = "Schnellplan";
    const harness = createHarness({
      select: (labels) => {
        if (
          choice === "Architekturplan" &&
          labels.includes("Workflow wechseln · /workflow")
        ) {
          return "Workflow wechseln · /workflow";
        }
        return labels.find((label) => label === choice);
      },
    });
    planMode.default(harness.api);
    controlPlane.default(harness.api);
    const context = harness.makeContext({ cwd });
    context.ui.custom = async () => {
      throw new Error("use deterministic select fallback");
    };
    await harness.runHooks("session_start", {}, context);

    const sentBeforePlanMode = harness.sent.length;
    await harness.shortcuts.get("shift+tab")(context);
    eq(
      harness.sent.length,
      sentBeforePlanMode,
      "Shift+Tab mode selection never sends a triggerTurn request",
    );

    choice = "Plan ausführen / fortsetzen";
    await harness.shortcuts.get("shift+tab")(context);
    eq(
      harness.sent.length,
      sentBeforePlanMode,
      "the unavailable plan-work entry cannot start execution",
    );
    const workContext = await harness.runHooks("before_agent_start", {}, context);
    assert(
      workContext.some((entry) =>
        entry?.message?.content?.includes("PI WORKFLOW: PLANUNG"),
      ),
      "the disabled plan-work entry leaves the selected planning mode intact",
    );

    choice = "Architekturplan";
    await harness.shortcuts.get("super+q")(context);
    await new Promise((resolve) => setImmediate(resolve));
    eq(
      harness.sent.length,
      sentBeforePlanMode,
      "the Control Center workflow tab uses the same passive mode switch",
    );
    const controlCenterPlanContext = await harness.runHooks(
      "before_agent_start",
      {},
      context,
    );
    assert(
      controlCenterPlanContext.some((entry) =>
        entry?.message?.content?.includes("PI WORKFLOW: PLANUNG"),
      ),
      "the Control Center waits for the next user turn before planning",
    );

    const sentBeforeExplicitPlan = harness.sent.length;
    await harness.commands.get("plan")("quick", context);
    assert(
      harness.sent.length === sentBeforeExplicitPlan + 1 &&
        harness.sent.at(-1)?.options?.triggerTurn === true,
      "/plan remains an explicit planning start",
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

await test("passive plan selection protects an existing plan", async () => {
  if (!planMode || !planUtils) return;
  const cwd = mkdtempSync(path.join(tmpdir(), "pi-passive-existing-plan-"));
  try {
    planUtils.writePlanFileAtomic(cwd, validPlan);
    const harness = createHarness({
      confirm: false,
      select: (labels) => labels.find((label) => label === "Schnellplan"),
    });
    planMode.default(harness.api);
    if (controlPlane) controlPlane.default(harness.api);
    const context = harness.makeContext({ cwd });
    context.ui.custom = async () => {
      throw new Error("use deterministic select fallback");
    };
    await harness.runHooks("session_start", {}, context);

    await harness.shortcuts.get("shift+tab")(context);
    assert(
      harness.lifecycleCalls.some(
        (entry) =>
          entry.kind === "confirm" && entry.title === "Aktiven Plan überarbeiten?",
      ),
      "a passive plan-mode selection confirms a revision before the next prompt can change it",
    );
    eq(harness.sent.length, 0, "declining the revision never starts a turn");
    const contextAfterDecline = await harness.runHooks(
      "before_agent_start",
      {},
      context,
    );
    assert(
      contextAfterDecline.every((entry) => entry === undefined),
      "declining leaves the next user prompt outside planning mode",
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

await test("/plan opens a v3 state-aware assistant", async () => {
  if (!planMode || !planUtils) return;
  const emptyCwd = mkdtempSync(path.join(tmpdir(), "pi-plan-assistant-empty-"));
  const activeCwd = mkdtempSync(path.join(tmpdir(), "pi-plan-assistant-active-"));
  try {
    const fresh = createHarness({
      select: (labels) =>
        labels.find((label) => label === "Neuen Schnellplan starten"),
    });
    planMode.default(fresh.api);
    const freshContext = fresh.makeContext({ cwd: emptyCwd });
    freshContext.ui.custom = async () => {
      throw new Error("use deterministic select fallback");
    };
    await fresh.runHooks("session_start", {}, freshContext);
    await fresh.commands.get("plan")("", freshContext);
    assert(
      fresh.sent.length === 1 && fresh.sent[0]?.options?.triggerTurn === true,
      "a new-plan assistant action retains /plan's explicit planning start",
    );

    const finalized = planSnapshot.finalizePlanDocument(
      v3Plan(),
      "simple_plan",
    );
    planStore.writePlanAndStateCAS(activeCwd, finalized.snapshot, "missing");
    const active = createHarness({
      confirm: false,
      select: (labels) =>
        labels.find((label) => label === "Plan überarbeiten"),
    });
    planMode.default(active.api);
    const activeContext = active.makeContext({ cwd: activeCwd });
    activeContext.ui.custom = async () => {
      throw new Error("use deterministic select fallback");
    };
    await active.runHooks("session_start", {}, activeContext);
    await active.commands.get("plan")("", activeContext);
    assert(
      active.lifecycleCalls.some(
        (entry) =>
          entry.kind === "confirm" && entry.title === "Aktiven Plan überarbeiten?",
      ),
      "the active-plan assistant routes revisions through the existing confirmation",
    );
    eq(active.sent.length, 0, "declining a revision leaves the plan untouched");
  } finally {
    rmSync(emptyCwd, { recursive: true, force: true });
    rmSync(activeCwd, { recursive: true, force: true });
  }
});

// Entfernt mit Workflow-v3-Vereinheitlichung: prüfte die Übergabe an die
// post-plan-card- und plan-menu-Module, die als abgehängt entfernt wurden.
// Ersatz: workflow-v3.mjs → "extension entry drives plan, work, completion,
// direct task and recovery" deckt den Handoff über den aktiven Pfad ab.

// Entfernt mit Workflow-v3-Vereinheitlichung: prüfte v2-Mechanik
// (Execution-IDs, Leases, abgelöste Statuslabels).
// Ersatz: workflow-v3.mjs → "extension entry drives plan, work, completion, direct task and recovery"

// Entfernt mit Workflow-v3-Vereinheitlichung: prüfte v2-Mechanik
// (Execution-IDs, Leases, abgelöste Statuslabels).
// Ersatz: workflow-v3.mjs → "sidecar CAS, immutable plan and deterministic archive"; v3 kennt keine Execution-IDs mehr

// Entfernt mit Workflow-v3-Vereinheitlichung: prüfte v2-Mechanik
// (Execution-IDs, Leases, abgelöste Statuslabels).
// Ersatz: workflow-v3.mjs → "changed plans and corrupt sidecars recover conservatively"

// Entfernt mit Workflow-v3-Vereinheitlichung: prüfte v2-Mechanik
// (Execution-IDs, Leases, abgelöste Statuslabels).
// Ersatz: workflow-v3.mjs → "completion marker is exact and pipeline rechecks stable diff"

// Entfernt mit Workflow-v3-Vereinheitlichung: prüfte v2-Mechanik
// (Execution-IDs, Leases, abgelöste Statuslabels).
// Ersatz: workflow-v3.mjs → "sidecar CAS, immutable plan and deterministic archive" (Session-Bindung über stateToken)

// Entfernt mit Workflow-v3-Vereinheitlichung: prüfte v2-Mechanik
// (Execution-IDs, Leases, abgelöste Statuslabels).
// Ersatz: workflow-v3.mjs → "changed plans and corrupt sidecars recover conservatively"

await test("new-plan abort guard runs before archival", async () => {
  if (!planMode || !planUtils) return;

  const refusedCwd = mkdtempSync(path.join(tmpdir(), "pi-new-plan-refused-"));
  const acceptedCwd = mkdtempSync(path.join(tmpdir(), "pi-new-plan-accepted-"));
  try {
    planUtils.writePlanFileAtomic(refusedCwd, validPlan);
    const refused = createHarness({
      idle: false,
      confirm: false,
      select: (labels) =>
        labels.find((label) => label.includes("Neuer Schnellplan")),
    });
    planMode.default(refused.api);
    const refusedContext = refused.makeContext({ cwd: refusedCwd });
    refusedContext.ui.custom = async () => {
      throw new Error("use deterministic select fallback");
    };
    await refused.runHooks("session_start", {}, refusedContext);
    await refused.commands.get("plan")("", refusedContext);
    assert(
      Boolean(planUtils.readPlanFile(refusedCwd)),
      "refused abort preserves the current plan",
    );
    eq(
      refused.lifecycleCalls.filter((entry) => entry.kind === "abort").length,
      0,
      "refused abort never stops the active turn",
    );
    eq(
      refused.lifecycleCalls.filter((entry) => entry.kind === "waitForIdle")
        .length,
      0,
      "refused abort never waits or archives",
    );

    // Der bestätigte Zweig prüfte die abgelöste "archive-first"-Semantik:
    // v3 archiviert bei /plan nicht mehr, sondern erzeugt eine Planrevision
    // (beginPlanning fragt "Aktiven Plan überarbeiten?").
    // Ersatz: workflow-v3.mjs → "PlanSnapshot metadata and stable ids".
  } finally {
    rmSync(refusedCwd, { recursive: true, force: true });
    rmSync(acceptedCwd, { recursive: true, force: true });
  }
});

// Entfernt mit Workflow-v3-Vereinheitlichung: prüfte v2-Mechanik
// (Execution-IDs, Leases, abgelöste Statuslabels).
// Ersatz: workflow-v3.mjs → "extension entry drives plan, work, completion, direct task and recovery"

await test(
  "--plan never confirms outside the TUI when a plan is already active",
  async () => {
    if (!planMode || !planStore || !planSnapshot) return;
    const cwd = mkdtempSync(path.join(tmpdir(), "pi-plan-headless-"));
    try {
      const finalized = planSnapshot.finalizePlanDocument(
        v3Plan(),
        "simple_plan",
      );
      planStore.writePlanAndStateCAS(cwd, finalized.snapshot, "missing");

      const harness = createHarness({ flags: { plan: true } });
      planMode.default(harness.api);
      const context = harness.makeContext({ cwd, mode: "json", hasUI: false });

      await harness.runHooks("session_start", {}, context);

      assert(
        !harness.lifecycleCalls.some((entry) => entry.kind === "confirm"),
        "activatePlanningMode never calls confirm outside the TUI",
      );
      assert(
        harness.notifications.some(
          (entry) =>
            entry.level === "warning" && entry.message.includes("TUI-Modus"),
        ),
        "the refusal to overwrite the active plan headlessly is reported",
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  },
);
