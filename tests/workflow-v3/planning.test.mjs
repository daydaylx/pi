/**
 * Planung: /plan, Planarten, Statuslabel und Abbruchschutz vor Archivierung.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { assert, eq, test } from "./assertions.mjs";
import { createHarness, latestStatus, assertNoGlobalChrome } from "../shared/harness.mjs";
import { validPlan, planUtils } from "../shared/plan-fixtures.mjs";
import { load } from "./harness.mjs";

const planMode = await load("extensions/plan-mode/index.ts");
const modePermissions = await load("extensions/mode-permissions.ts");

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
