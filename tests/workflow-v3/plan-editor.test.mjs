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
    const writeResult = storeMod.writePlanAndStateCAS(
      tmpDir,
      first.snapshot,
      "missing",
    );

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
      isProjectTrusted: () => true,
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

await test("editPlanMarkdown is blocked in untrusted projects", async () => {
  let opened = false;
  let notifiedMessage = "";
  const session = {
    reload() {
      throw new Error("untrusted edit must not load workflow files");
    },
    notify(_ctx, message) {
      notifiedMessage = message;
    },
  };
  await planEditor.editPlanMarkdown(session, {
    cwd: "/unused",
    isProjectTrusted: () => false,
    ui: {
      async openExternalEditor() {
        opened = true;
      },
    },
  });
  assert(!opened, "untrusted projects never open an editor");
  assert(
    notifiedMessage.includes("Trust-Grenze"),
    "untrusted edit reports the hard trust boundary",
  );
});

await test("editPlanMarkdown preserves a concurrent plan revision", async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "pi-test-editor-conflict-"));
  try {
    const first = snapshotMod.finalizePlanDocument(quickPlan(), "simple_plan");
    const initial = storeMod.writePlanAndStateCAS(
      tmpDir,
      first.snapshot,
      "missing",
    );
    const concurrent = snapshotMod.finalizePlanDocument(
      quickPlan("Konkurrierende Änderung"),
      "simple_plan",
    );
    const session = sessionMod.createWorkflowSession({ events: { emit() {} } });
    session.current = {
      state: initial.state,
      snapshot: first.snapshot,
      stateToken: initial.stateToken,
      recovered: false,
      migrationRequired: false,
      warnings: [],
    };
    session.notify = () => {};
    const context = {
      cwd: tmpDir,
      isProjectTrusted: () => true,
      ui: {
        async openExternalEditor() {
          storeMod.writePlanAndStateCAS(
            tmpDir,
            concurrent.snapshot,
            initial.stateToken,
            initial.state,
          );
        },
      },
    };

    await planEditor.editPlanMarkdown(session, context);

    equal(
      readFileSync(join(tmpDir, storeMod.PLAN_RELATIVE_PATH), "utf8"),
      concurrent.content,
      "the failed editor synchronization never overwrites a concurrent revision",
    );
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

await test("editPlanMarkdown labels a markdown validation failure distinctly and resets the file", async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "pi-test-editor-invalid-"));
  try {
    const first = snapshotMod.finalizePlanDocument(quickPlan(), "simple_plan");
    const initial = storeMod.writePlanAndStateCAS(
      tmpDir,
      first.snapshot,
      "missing",
    );

    const session = sessionMod.createWorkflowSession({ events: { emit() {} } });
    session.current = {
      state: initial.state,
      snapshot: first.snapshot,
      stateToken: initial.stateToken,
      recovered: false,
      migrationRequired: false,
      warnings: [],
    };
    let notifiedMessage = "";
    session.notify = (_ctx, msg) => {
      notifiedMessage = msg;
    };

    // Drop the required steps section entirely: finalizePlanDocument must
    // reject this, with no concurrent writer involved.
    const invalidPlanText = first.content.replace(
      /## Umsetzungsschritte\n1\. .*\n2\. .*\n/,
      "## Umsetzungsschritte\n",
    );

    const context = {
      cwd: tmpDir,
      isProjectTrusted: () => true,
      ui: {
        async openExternalEditor(path) {
          writeFileSync(path, invalidPlanText, "utf8");
        },
      },
    };

    await planEditor.editPlanMarkdown(session, context);

    assert(
      notifiedMessage.startsWith("Markdown ungültig:"),
      "a validation error is labelled distinctly from a concurrency conflict",
    );
    assert(
      notifiedMessage.includes("sicher zurückgesetzt"),
      "without a concurrent writer, the CAS restore succeeds",
    );
    equal(
      readFileSync(join(tmpDir, storeMod.PLAN_RELATIVE_PATH), "utf8"),
      first.content,
      "the plan file is reverted to the pre-edit revision",
    );
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

await test("editPlanMarkdown labels a concurrent conflict distinctly from a validation error", async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "pi-test-editor-conflict-msg-"));
  try {
    const first = snapshotMod.finalizePlanDocument(quickPlan(), "simple_plan");
    const initial = storeMod.writePlanAndStateCAS(
      tmpDir,
      first.snapshot,
      "missing",
    );
    const concurrent = snapshotMod.finalizePlanDocument(
      quickPlan("Konkurrierende Änderung"),
      "simple_plan",
    );
    const session = sessionMod.createWorkflowSession({ events: { emit() {} } });
    session.current = {
      state: initial.state,
      snapshot: first.snapshot,
      stateToken: initial.stateToken,
      recovered: false,
      migrationRequired: false,
      warnings: [],
    };
    let notifiedMessage = "";
    session.notify = (_ctx, msg) => {
      notifiedMessage = msg;
    };
    const context = {
      cwd: tmpDir,
      isProjectTrusted: () => true,
      ui: {
        async openExternalEditor() {
          storeMod.writePlanAndStateCAS(
            tmpDir,
            concurrent.snapshot,
            initial.stateToken,
            initial.state,
          );
        },
      },
    };

    await planEditor.editPlanMarkdown(session, context);

    assert(
      notifiedMessage.startsWith("Nebenläufige Änderung erkannt:"),
      "a concurrency conflict is labelled distinctly from a validation error",
    );
    assert(
      !notifiedMessage.includes("Markdown ungültig"),
      "a valid-but-outdated edit is never described as an invalid markdown edit",
    );
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});
