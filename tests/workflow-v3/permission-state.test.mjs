/**
 * Permission-State: Statuslebenszyklus, Workflow-Defaults, YOLO und Workflow-Capabilities.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { assert, eq, test } from "./assertions.mjs";
import { createHarness, latestStatus, assertNoGlobalChrome } from "../shared/harness.mjs";
import { validPlan } from "../shared/plan-fixtures.mjs";
import { load } from "./harness.mjs";

const planMode = await load("extensions/plan-mode/index.ts");
const modePermissions = await load("extensions/mode-permissions.ts");
const controlPlane = await load("extensions/control-plane.ts");

await test("permission status lifecycle", async () => {
  if (!modePermissions) return;
  const guarded = createHarness({ confirm: false });
  modePermissions.default(guarded.api);
  const guardedContext = guarded.makeContext({ mode: "json", hasUI: false });
  await guarded.runHooks("session_start", {}, guardedContext);
  const bashDecision = await guarded.runHooks(
    "tool_call",
    { toolName: "bash", input: { command: "npm install example-package" } },
    guardedContext,
  );
  assert(
    bashDecision.some((result) => result?.block === true),
    "the read-bash workflow default blocks mutating shell commands",
  );
  const unknownDecision = await guarded.runHooks(
    "tool_call",
    { toolName: "mcp_external_write", input: {} },
    guardedContext,
  );
  assert(
    unknownDecision.some((result) => result?.block === true),
    "unknown tools require confirmation by default",
  );
  const spoofedLspDecision = await guarded.runHooks(
    "tool_call",
    { toolName: "lsp_write", input: {} },
    guardedContext,
  );
  assert(
    spoofedLspDecision.some((result) => result?.block === true),
    "an lsp_ prefix cannot spoof a local read-only capability",
  );
  for (const toolName of ["lsp_hover", "plan_progress", "ask_user", "verify"]) {
    const decisions = await guarded.runHooks(
      "tool_call",
      { toolName, input: {} },
      guardedContext,
    );
    assert(
      decisions.every((result) => result === undefined),
      `${toolName} has an explicit local capability`,
    );
  }

  const harness = createHarness();
  modePermissions.default(harness.api);
  if (controlPlane) controlPlane.default(harness.api);
  const context = harness.makeContext();
  await harness.runHooks("session_start", {}, context);
  eq(
    latestStatus(harness, "permissions"),
    "🛡 DEFAULT · PROJECT WRITE",
    "session start exposes the workflow default in the footer",
  );
  assert(!harness.commands.has("write"), "/write is no longer registered");
  await harness.commands.get("permission")("read-only", context);
  eq(
    latestStatus(harness, "permissions"),
    "🛡 MANUELL · READONLY",
    "/permission marks a manual ordinary access level in the footer",
  );
  eq(
    harness.appended.at(-1)?.data,
    {
      timestamp: harness.appended.at(-1)?.data?.timestamp,
      source: "command",
      state: "MANUAL",
      selectedState: "MANUAL",
      effectiveLevel: "readonly",
      selectedLevel: "readonly",
      workflowDefaultLevel: "project-write",
      workflowMode: "work",
    },
    "permission changes append a redacted transition audit record",
  );
  assert(
    harness.emitted.every((event) => event.name !== "workflow-status"),
    "permission changes no longer publish a legacy workflow-status event",
  );
  const toolResults = await harness.runHooks(
    "tool_call",
    { toolName: "edit", input: { path: "src/app.ts" } },
    context,
  );
  assert(
    toolResults.some((result) => result?.block === true),
    "read-only still blocks write tools",
  );
  await harness.commands.get("permission")("read-bash", context);
  eq(
    latestStatus(harness, "permissions"),
    "🛡 MANUELL · READONLY",
    "/permission maps the legacy read-bash level to readonly",
  );
  await harness.commands.get("yolo")("", context);
  eq(
    latestStatus(harness, "permissions"),
    "⚠ YOLO · TEMPORÄR",
    "/yolo remains an explicit visible warning",
  );
  const yoloUnknown = await harness.runHooks(
    "tool_call",
    { toolName: "mcp_unclassified_mutation", input: {} },
    context,
  );
  assert(
    yoloUnknown.every((result) => result === undefined),
    "YOLO bypasses confirmation for unknown tools",
  );
  const yoloExternalWrite = await harness.runHooks(
    "tool_call",
    { toolName: "write", input: { path: "/etc/pi-agent-test", content: "x" } },
    context,
  );
  assert(
    yoloExternalWrite.some((result) => result !== undefined),
    "YOLO retains the hard system-path file boundary",
  );
  const yoloShell = await harness.runHooks(
    "user_bash",
    { command: "sudo rm -rf /" },
    context,
  );
  assert(
    yoloShell.some((result) => result !== undefined),
    "YOLO retains the hard elevated-rights shell boundary",
  );
  const yoloShortcut = harness.shortcuts.get("super+y");
  assert(Boolean(yoloShortcut), "Super+Y is registered as the YOLO toggle");
  if (yoloShortcut) await yoloShortcut(context);
  eq(
    latestStatus(harness, "permissions"),
    "🛡 MANUELL · READONLY",
    "Super+Y returns to the previous normal access level",
  );
  await harness.runHooks("session_shutdown", {}, context);
  eq(
    latestStatus(harness, "permissions"),
    undefined,
    "permission status clears on shutdown",
  );
  assertNoGlobalChrome(harness, "permissions install no global chrome");

  const yoloResume = createHarness({
    entries: [
      {
        type: "custom",
        customType: "mode-permissions",
        data: { permissionLevel: "yolo" },
      },
    ],
  });
  modePermissions.default(yoloResume.api);
  const yoloResumeContext = yoloResume.makeContext();
  await yoloResume.runHooks("session_start", {}, yoloResumeContext);
  eq(
    latestStatus(yoloResume, "permissions"),
    "🛡 MANUELL · PROJECT WRITE",
    "persisted YOLO is downgraded to project-write on session start",
  );

  const readBashResume = createHarness({
    entries: [
      {
        type: "custom",
        customType: "mode-permissions",
        data: { permissionLevel: "read-bash" },
      },
    ],
  });
  modePermissions.default(readBashResume.api);
  const readBashResumeContext = readBashResume.makeContext();
  await readBashResume.runHooks("session_start", {}, readBashResumeContext);
  eq(
    latestStatus(readBashResume, "permissions"),
    "🛡 MANUELL · READONLY",
    "a persisted explicit level survives as a manual selection",
  );

  const manualThinkingResume = createHarness({
    thinkingLevel: "low",
    entries: [
      {
        type: "custom",
        customType: "mode-permissions",
        data: {
          permissionLevel: "read-write",
          thinkingMode: "manual",
          manualThinkingLevel: "xhigh",
        },
      },
    ],
  });
  modePermissions.default(manualThinkingResume.api);
  await manualThinkingResume.runHooks(
    "session_start",
    {},
    manualThinkingResume.makeContext(),
  );
  eq(
    manualThinkingResume.api.getThinkingLevel(),
    "xhigh",
    "manual Thinking is restored from the session state",
  );
});

await test(
  "workflow defaults and manual permissions stay separate",
  async () => {
    if (!modePermissions || !planMode) return;
    const cwd = mkdtempSync(path.join(tmpdir(), "pi-workflow-permission-p1-"));
    try {
      const restored = createHarness({
        flags: { plan: true },
        thinkingLevel: "low",
      });
      planMode.default(restored.api);
      modePermissions.default(restored.api);
      const restoredContext = restored.makeContext({ cwd });
      await restored.runHooks("session_start", {}, restoredContext);
      // Asserts the ORDER (recovery resolves before permissions read the
      // default), not the level. The level itself is "high" since 4c7a201;
      // the retired MODE_THINKING table used "xhigh" for detailed plans.
      eq(
        restored.api.getThinkingLevel(),
        "high",
        "plan recovery completes before permissions resolve the auto Thinking default",
      );

      const harness = createHarness();
      planMode.default(harness.api);
      modePermissions.default(harness.api);
      const context = harness.makeContext({ cwd });
      await harness.runHooks("session_start", {}, context);
      await harness.commands.get("permission")("full-access", context);
      harness.api.events.emit("workflow-capabilities:activated", {
        cwd,
        sessionId: context.sessionManager.getSessionId(),
        mode: "detailed_plan",
      });
      eq(
        latestStatus(harness, "permissions"),
        "🛡 MANUELL · CONFIRM ALL",
        "a manual confirm-all selection survives a workflow activation",
      );
      await harness.commands.get("yolo")("", context);
      await harness.commands.get("yolo")("", context);
      eq(
        latestStatus(harness, "permissions"),
        "🛡 MANUELL · CONFIRM ALL",
        "leaving YOLO restores the prior manual permission selection",
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  },
);

await test(
  "unknown-tool handling distinguishes full access from YOLO",
  async () => {
    if (!modePermissions) return;
    for (const level of ["full-access"]) {
      const harness = createHarness({ confirm: false });
      modePermissions.default(harness.api);
      const context = harness.makeContext({ mode: "json", hasUI: false });
      await harness.runHooks("session_start", {}, context);
      await harness.commands.get("permission")(level, context);
      const decisions = await harness.runHooks(
        "tool_call",
        { toolName: "mcp_unclassified_mutation", input: {} },
        context,
      );
      assert(
        decisions.some(
          (result) =>
            result?.block === true && result.reason.includes("Bestätigung"),
        ),
        `${level} still asks before an unclassified tool`,
      );
    }
    const yoloHarness = createHarness({ confirm: false });
    modePermissions.default(yoloHarness.api);
    const yoloContext = yoloHarness.makeContext({ mode: "json", hasUI: false });
    await yoloHarness.runHooks("session_start", {}, yoloContext);
    await yoloHarness.commands.get("permission")("yolo", yoloContext);
    const yoloDecisions = await yoloHarness.runHooks(
      "tool_call",
      { toolName: "mcp_unclassified_mutation", input: {} },
      yoloContext,
    );
    assert(
      yoloDecisions.every((result) => result === undefined),
      "YOLO bypasses unclassified-tool confirmation",
    );
  },
);

await test(
  "workflow capabilities constrain plan writes and subagents",
  async () => {
    if (!modePermissions || !planMode) return;
    const cwd = mkdtempSync(path.join(tmpdir(), "pi-workflow-capabilities-"));
    try {
      const harness = createHarness();
      planMode.default(harness.api);
      modePermissions.default(harness.api);
      const context = harness.makeContext({ cwd, mode: "json", hasUI: false });
      await harness.runHooks("session_start", {}, context);
      // Pass the plan kind as an argument: this context is non-interactive,
      // so the ui.select fallback would never resolve one.
      await harness.commands.get("plan")("quick", context);

      const planWrite = await harness.runHooks(
        "tool_call",
        {
          toolName: "write",
          input: { path: ".agent/plans/current-plan.md", content: validPlan },
        },
        context,
      );
      assert(
        planWrite.every((result) => result === undefined),
        "planning allows the controlled current-plan write",
      );

      const sourceWrite = await harness.runHooks(
        "tool_call",
        { toolName: "edit", input: { path: "src/app.ts" } },
        context,
      );
      assert(
        sourceWrite.some((result) => result?.block === true),
        "planning blocks writes outside the current plan",
      );

      const worker = await harness.runHooks(
        "tool_call",
        { toolName: "subagent", input: { agent: "worker", task: "implement" } },
        context,
      );
      assert(
        worker.some((result) => result?.block === true),
        "planning blocks mutating worker subagents",
      );

      const scout = await harness.runHooks(
        "tool_call",
        { toolName: "subagent", input: { agent: "reviewer", task: "inspect" } },
        context,
      );
      assert(
        scout.every((result) => result === undefined),
        "planning allows a known read-only subagent profile",
      );

      await harness.commands.get("yolo")("", context);
      const yoloSourceWrite = await harness.runHooks(
        "tool_call",
        { toolName: "edit", input: { path: "src/app.ts" } },
        context,
      );
      // The planning promise ("nothing gets implemented while planning") is
      // decided before the permission level is consulted, so YOLO does not
      // lift it — it only bypasses confirmations.
      assert(
        yoloSourceWrite.some((result) => result?.block === true),
        "YOLO does not lift the planning write restriction",
      );
      harness.api.events.emit("workflow-capabilities:activated", {
        cwd,
        sessionId: context.sessionManager.getSessionId(),
        mode: "detailed_plan",
      });
      const resetSourceWrite = await harness.runHooks(
        "tool_call",
        { toolName: "edit", input: { path: "src/app.ts" } },
        context,
      );
      assert(
        resetSourceWrite.some((result) => result?.block === true),
        "workflow activation resets YOLO to its declared default",
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  },
);
