/**
 * Tests for plan-editor module (viewPlanMarkdown, editPlanMarkdown).
 */
import { assert, equal, test } from "./assertions.mjs";
import { quickPlan } from "../shared/plan-fixtures.mjs";
import { load } from "./harness.mjs";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const snapshotMod = await load("extensions/plan-mode/plan-snapshot.ts");
const planEditor = await load("extensions/plan-mode/plan-editor.ts");
const storeMod = await load("extensions/plan-mode/store/index.ts");
const sessionMod = await load("extensions/plan-mode/session.ts");

await test("plan-editor module loads and exports expected functions", () => {
  assert(
    typeof planEditor.viewPlanMarkdown === "function",
    "viewPlanMarkdown is exported",
  );
  assert(
    typeof planEditor.editPlanMarkdown === "function",
    "editPlanMarkdown is exported",
  );
});

await test("viewPlanMarkdown notifies when no plan exists", async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "pi-test-editor-"));
  try {
    let notifiedMessage = "";
    let notifiedLevel = "";
    const mockSession = {
      reload() {
        return {
          stateToken: "missing",
          recovered: false,
          migrationRequired: false,
          warnings: [],
        };
      },
      notify(_ctx, message, level) {
        notifiedMessage = message;
        notifiedLevel = level;
      },
    };
    const mockCtx = { cwd: tmpDir, ui: {} };
    await planEditor.viewPlanMarkdown(mockSession, mockCtx);
    assert(
      notifiedMessage.includes("Kein aktiver Plan zum Anzeigen vorhanden"),
      "warns when plan file does not exist",
    );
    equal(notifiedLevel, "warning", "warning level used");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

await test("editPlanMarkdown processes manual plan updates via CAS", async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "pi-test-editor-"));
  try {
    const plansDir = join(tmpDir, ".agent", "plans");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(plansDir, { recursive: true });

    // Initialize plan & state
    const first = snapshotMod.finalizePlanDocument(quickPlan(), "simple_plan");
    const writeResult = storeMod.writePlanAndStateCAS(tmpDir, first.snapshot, "missing");

    let notifiedMessage = "";
    let notifiedLevel = "";

    const session = sessionMod.createWorkflowSession({
      events: { emit() {} },
    });
    session.current = {
      state: writeResult.state,
      snapshot: first.snapshot,
      stateToken: writeResult.stateToken,
      recovered: false,
      migrationRequired: false,
      warnings: [],
    };
    session.notify = (_ctx, msg, lvl) => {
      notifiedMessage = msg;
      notifiedLevel = lvl;
    };

    // Simulate mock editor that adds a new line in implementation steps
    const updatedPlanText = first.content.replace(
      "1. Implementiere den Adapter",
      "1. Implementiere den Adapter\n2. Manuell hinzugefügter Schritt",
    );

    const mockCtx = {
      cwd: tmpDir,
      ui: {
        openExternalEditor: async (path) => {
          writeFileSync(path, updatedPlanText, "utf8");
        },
      },
    };

    await planEditor.editPlanMarkdown(session, mockCtx);

    assert(
      notifiedMessage.includes("Plan manuell aktualisiert"),
      "notifies successful manual update",
    );
    equal(notifiedLevel, "info", "info level used");

    const diskContent = readFileSync(join(plansDir, "current-plan.md"), "utf8");
    assert(
      diskContent.includes("Manuell hinzugefügter Schritt"),
      "disk plan includes edited text",
    );
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});
