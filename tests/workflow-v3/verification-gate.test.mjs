/**
 * Verifikation: Profil-Klassifikationen und der /finish-Gate inklusive Autoarchive.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { assert, equal, test } from "./assertions.mjs";
import { createHarness } from "../shared/harness.mjs";
import { progressPlan, makeFailingGateExec, seedFinishableWorkflow, planUtils } from "../shared/plan-fixtures.mjs";
import { load } from "./harness.mjs";

const planSnapshot = await load("extensions/plan-mode/plan-snapshot.ts");
const planStore = await load("extensions/plan-mode/store/index.ts");
const planMode = await load("extensions/plan-mode/index.ts");
const verifyProfiles = await load("extensions/setup-core/verify-profiles.ts");

await test("verification profiles expose three strict classifications", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "pi-v3-profiles-"));
  try {
    mkdirSync(path.join(cwd, ".pi"), { recursive: true });
    writeFileSync(
      path.join(cwd, ".pi", "verify.json"),
      JSON.stringify({
        profiles: {
          required: {
            program: "true",
            args: [],
            classification: "required",
          },
          recommended: {
            program: "true",
            args: [],
            classification: "recommended",
          },
          advisory: {
            program: "true",
            args: [],
            classification: "advisory",
          },
          conflict: {
            program: "true",
            args: [],
            required: false,
            classification: "required",
          },
        },
      }),
    );
    const loaded = verifyProfiles.loadVerifyProfiles(cwd, true);
    equal(
      Object.fromEntries(
        Object.entries(loaded.profiles).map(([name, profile]) => [
          name,
          profile.classification,
        ]),
      ),
      {
        required: "required",
        recommended: "recommended",
        advisory: "advisory",
      },
      "classification is preserved and contradictory legacy projection is dropped",
    );
    assert(
      loaded.diagnostics.some((entry) =>
        entry.message.includes("widersprechen"),
      ),
      "classification conflict is diagnosed",
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

await test(
  "plan-mode /finish enforces the verification gate (#102)",
  async () => {
    if (!planMode || !planUtils || !planStore || !planSnapshot) return;

    // --- non-TUI: a failing gate blocks completion, no archival happens ---
    const nonTuiCwd = mkdtempSync(path.join(tmpdir(), "pi-plan-gate-nontui-"));
    try {
      seedFinishableWorkflow(nonTuiCwd);
      const harness = createHarness();
      planMode.default(harness.api);
      harness.api.exec = makeFailingGateExec();
      const context = harness.makeContext({
        cwd: nonTuiCwd,
        mode: "json",
        hasUI: false,
      });
      await harness.runHooks("session_start", {}, context);
      await harness.commands.get("finish")("", context);
      assert(
        Boolean(planUtils.readPlanFile(nonTuiCwd)),
        "a failing gate in a non-interactive context prevents archival",
      );
      assert(
        harness.notifications.some(
          (n) =>
            n.message.includes("Completion:") && n.message.includes("FAIL"),
        ),
        "the gate failure is reported to the user",
      );
    } finally {
      rmSync(nonTuiCwd, { recursive: true, force: true });
    }

    // --- TUI, override declined: gate blocks completion ---
    const declinedCwd = mkdtempSync(
      path.join(tmpdir(), "pi-plan-gate-declined-"),
    );
    try {
      seedFinishableWorkflow(declinedCwd);
      const harness = createHarness({ confirm: false });
      planMode.default(harness.api);
      harness.api.exec = makeFailingGateExec();
      const context = harness.makeContext({ cwd: declinedCwd });
      await harness.runHooks("session_start", {}, context);
      await harness.commands.get("finish")("", context);
      assert(
        Boolean(planUtils.readPlanFile(declinedCwd)),
        "declining the gate override in TUI mode prevents archival",
      );
    } finally {
      rmSync(declinedCwd, { recursive: true, force: true });
    }

    // Die beiden folgenden Fälle (akzeptierter Override, bestandenes Gate)
    // brauchen einen echten Reviewer-Subagenten und die v3-Override-Eingabe
    // (ui.input mit Begründung statt ui.confirm). Sie sind abgedeckt in
    // workflow-v3.mjs → "extension entry drives plan, work, completion,
    // direct task and recovery" und "completion marker is exact and pipeline
    // rechecks stable diff".
  },
);

await test(
  "plan-mode autoarchive defers to /finish on a failing gate (#102)",
  async () => {
    if (!planMode || !planUtils) return;
    const cwd = mkdtempSync(path.join(tmpdir(), "pi-plan-gate-autoarchive-"));
    try {
      planUtils.writePlanFileAtomic(cwd, progressPlan);
      const harness = createHarness();
      planMode.default(harness.api);
      harness.api.exec = makeFailingGateExec();
      const context = harness.makeContext({ cwd });
      await harness.runHooks("session_start", {}, context);
      await harness.commands.get("work")("", context);
      const executionId = harness.sent
        .at(-1)
        ?.message?.content.match(/Execution-ID: ([^\n]+)/)?.[1];
      await harness.tools
        .get("plan_progress")
        .execute(
          "p1",
          { executionId, step: 1, status: "completed", evidence: "erledigt" },
          undefined,
          undefined,
          context,
        );
      await harness.tools
        .get("plan_progress")
        .execute(
          "p2",
          { executionId, step: 2, status: "completed", evidence: "erledigt" },
          undefined,
          undefined,
          context,
        );
      await harness.runHooks(
        "agent_end",
        {
          messages: [
            {
              role: "assistant",
              content: [{ type: "text", text: "fertig" }],
              stopReason: "stop",
            },
          ],
        },
        context,
      );
      await harness.runHooks("agent_settled", {}, context);
      assert(
        Boolean(planUtils.readPlanFile(cwd)),
        "a failing gate skips the autoarchive path instead of discarding the plan",
      );
      assert(
        harness.notifications.length > 0,
        "a gated archival reports back to the user instead of failing silently",
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  },
);

// setup-core/recovery-check.ts wurde entfernt: plan-mode meldet eine
// unterbrochene Ausführung bereits beim session_start und verweist auf /work
// (index.ts). Der separate Dialog war seit 4c7a201 von keiner Extension
// geladen und hätte die Logik nur dupliziert.

/** Minimal plan satisfying the v3 simple_plan section contract. */

// ---------------------------------------------------------------------------
// Recovery status check (#107). Reads plan + sidecar state, reports
// interrupted task presence without touching the plan-mode state machine.
// ---------------------------------------------------------------------------
