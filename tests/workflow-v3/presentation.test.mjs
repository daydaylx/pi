/**
 * Präsentation: Statuslabel, Statusschlüssel und Risikodarstellung.
 */
import { eq, test } from "./assertions.mjs";
import { load } from "./harness.mjs";

const workflowStatus = await load("extensions/shared/workflow-status.ts");
const planPresentation = await load("extensions/plan-mode/presentation.ts");

await test("status mapping helpers", async () => {
  if (!workflowStatus) return;
  eq(
    workflowStatus.UI_STATUS_KEYS,
    {
      permissions: "permissions",
      workflow: "workflow",
    },
    "only workflow and risk status keys remain",
  );
  eq(
    workflowStatus.normalizePermissionLevel("test-bash"),
    "readonly",
    "legacy test-bash state migrates conservatively",
  );
  eq(
    workflowStatus.permissionRiskStatusValue("readonly"),
    "🛡 DEFAULT · READONLY",
    "ordinary read-only access remains visible in the footer",
  );
  eq(
    workflowStatus.permissionRiskStatusValue("confirm-all"),
    "🛡 DEFAULT · CONFIRM ALL",
    "confirm-all is an explicit footer state",
  );
  eq(
    workflowStatus.permissionRiskStatusValue("yolo"),
    "⚠ YOLO · TEMPORÄR",
    "YOLO exposes its temporary bypass in the footer",
  );

  // The workflow label itself moved to plan-mode/presentation.ts, the single
  // place mapping the canonical WorkflowStatus to a German label. Assert it
  // through the same helper the extension calls.
  if (planPresentation) {
    const labelFor = (status, steps = []) => {
      let value;
      planPresentation.updateWorkflowPresentation(
        {
          mode: "tui",
          hasUI: true,
          ui: {
            setStatus: (key, next) => {
              if (key === "workflow") value = next;
            },
          },
        },
        { status, steps },
      );
      return value;
    };
    const done = { status: "completed" };
    const open = { status: "pending" };
    eq(labelFor("planning"), "PLANUNG", "planning is PLANUNG");
    eq(labelFor("reviewing"), "REVIEW", "review is REVIEW");
    eq(labelFor("done"), "FERTIG", "a finished workflow is FERTIG");
    eq(
      labelFor("working", [done, open, open]),
      "ARBEIT 1/3",
      "execution includes compact step progress",
    );
    eq(
      labelFor("paused", [done, open]),
      "PAUSIERT 1/2",
      "paused execution is visible with progress",
    );
    eq(
      labelFor("blocked", [open, open]),
      "BLOCKIERT 0/2",
      "blocked execution is visible with progress",
    );
    let missing;
    planPresentation.updateWorkflowPresentation(
      {
        mode: "tui",
        hasUI: true,
        ui: {
          setStatus: (key, next) => {
            if (key === "workflow") missing = next;
          },
        },
      },
      undefined,
    );
    eq(missing, "ARBEIT", "no workflow state falls back to the idle label");
  }

  const calls = [];
  workflowStatus.setTuiStatus(
    {
      mode: "json",
      hasUI: false,
      ui: { setStatus: (...args) => calls.push(args) },
    },
    "permissions",
    "⚠ YOLO",
  );
  eq(calls, [], "status helper is silent outside TUI mode");
});
