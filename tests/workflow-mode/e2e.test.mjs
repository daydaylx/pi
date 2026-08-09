import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assert, eq, test } from "../shared/assertions.mjs";
import { createHarness, latestStatus } from "../shared/harness.mjs";
import { importModule as load } from "../shared/jiti-loader.mjs";

const planMode = await load("extensions/plan-mode/index.ts");
const modePermissions = await load("extensions/mode-permissions.ts");

async function hooks(harness, name, ctx) {
  return harness.runHooks(name, {}, ctx);
}

function writePlan(cwd, content) {
  mkdirSync(join(cwd, ".agent", "plans"), { recursive: true });
  writeFileSync(join(cwd, ".agent", "plans", "current-plan.md"), content);
}

function planFilePath(cwd) {
  return join(cwd, ".agent", "plans", "current-plan.md");
}

async function chooseWorkflow(harness, ctx) {
  await harness.shortcuts.get("shift+tab")(ctx);
}

for (const [label, modeLabel, mode] of [
  ["Schnellplan", "PI PLANMODUS", "simple_plan"],
  ["Architekturplan", "PI PLANMODUS", "detailed_plan"],
]) {
  await test(`Shift+Tab → ${label} waits for the real planning prompt`, async () => {
    if (!planMode) return;
    const cwd = mkdtempSync(join(tmpdir(), "pi-workflow-plan-"));
    try {
      writePlan(cwd, "# Alter Plan\n");
      const harness = createHarness({ select: () => label });
      const ctx = harness.makeContext({ cwd });
      planMode.default(harness.api);
      await hooks(harness, "session_start", ctx);

      await chooseWorkflow(harness, ctx);
      eq(latestStatus(harness, "workflow"), label, `${mode} is active after selection`);
      eq(harness.sent.length, 0, "mode selection sends no synthetic prompt");
      assert(existsSync(planFilePath(cwd)), "mode selection preserves the plan");

      const prompt = await hooks(harness, "before_agent_start", ctx);
      assert(
        prompt[0]?.message?.content.includes(modeLabel),
        "the next real user turn receives planning context",
      );
      assert(
        !existsSync(planFilePath(cwd)),
        "the old plan is replaced only when the planning turn starts",
      );
      eq(harness.sent.length, 0, "the planning context does not synthesize a user message");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
}

await test("Shift+Tab → Work waits and does not execute an existing plan", async () => {
  if (!planMode) return;
  const cwd = mkdtempSync(join(tmpdir(), "pi-workflow-work-"));
  try {
    writePlan(cwd, "# Bestehender Plan\n");
    const harness = createHarness({ select: () => "Work" });
    const ctx = harness.makeContext({ cwd });
    planMode.default(harness.api);
    await hooks(harness, "session_start", ctx);

    await chooseWorkflow(harness, ctx);
    eq(harness.sent.length, 0, "work selection starts no turn");
    assert(existsSync(planFilePath(cwd)), "work selection leaves the plan untouched");
    const prompt = await hooks(harness, "before_agent_start", ctx);
    assert(prompt[0]?.message?.content.includes("PI WORKMODUS"), "the next real prompt is work");
    assert(!prompt[0]?.message?.content.includes("Bestehender Plan"), "a stale plan is not injected");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

await test("a settled Plan → Work handoff ignores retry intermediates and stays one-shot", async () => {
  if (!planMode) return;
  const cwd = mkdtempSync(join(tmpdir(), "pi-workflow-handoff-"));
  try {
    let choice = "Schnellplan";
    const harness = createHarness({ select: () => choice });
    const ctx = harness.makeContext({ cwd });
    planMode.default(harness.api);
    await hooks(harness, "session_start", ctx);

    await chooseWorkflow(harness, ctx);
    await hooks(harness, "before_agent_start", ctx);
    writePlan(cwd, "# Zwischenstand vor Retry\n");
    await hooks(harness, "agent_end", ctx);
    writePlan(cwd, "# Neuer Plan\n\nUmsetzen\n");
    await hooks(harness, "agent_settled", ctx);

    choice = "Work";
    await chooseWorkflow(harness, ctx);
    eq(harness.sent.length, 0, "switching to work still starts no turn");
    const handoff = await hooks(harness, "before_agent_start", ctx);
    assert(handoff[0]?.message?.content.includes("Neuer Plan"), "the settled plan is included once");
    assert(
      !handoff[0]?.message?.content.includes("Zwischenstand vor Retry"),
      "an earlier low-level agent_end cannot freeze a retry intermediate",
    );

    await chooseWorkflow(harness, ctx);
    const later = await hooks(harness, "before_agent_start", ctx);
    assert(!later[0]?.message?.content.includes("Neuer Plan"), "Work → Work does not resurrect the handoff");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

await test("a resumed session never hands off a plan file from an earlier session", async () => {
  if (!planMode) return;
  const cwd = mkdtempSync(join(tmpdir(), "pi-workflow-resume-"));
  try {
    writePlan(cwd, "# Plan der alten Sitzung\n");
    const harness = createHarness();
    const ctx = harness.makeContext({ cwd });
    planMode.default(harness.api);
    await hooks(harness, "session_start", ctx);
    const prompt = await hooks(harness, "before_agent_start", ctx);
    assert(!prompt[0]?.message?.content.includes("Plan der alten Sitzung"), "resumed work ignores stale plan files");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

await test("Plan Mode mutation guard keeps the plan file writable", async () => {
  if (!planMode || !modePermissions) return;
  const cwd = mkdtempSync(join(tmpdir(), "pi-plan-mode-guard-"));
  try {
    const harness = createHarness({ select: () => "Architekturplan" });
    planMode.default(harness.api);
    modePermissions.default(harness.api);
    const ctx = harness.makeContext({ cwd });
    await hooks(harness, "session_start", ctx);
    await chooseWorkflow(harness, ctx);

    const writeEvent = (path) => ({ toolName: "write", input: { path } });
    let result = await harness.runHooks("tool_call", writeEvent(".agent/plans/current-plan.md"), ctx);
    assert(!result.some((entry) => entry?.block), "the plan file is auto-allowed");
    result = await harness.runHooks("tool_call", writeEvent("src/example.ts"), ctx);
    assert(result.some((entry) => entry?.block), "other writes remain blocked while planning");

    await harness.commands.get("permission")("confirm-all", ctx);
    result = await harness.runHooks("tool_call", writeEvent("src/example.ts"), ctx);
    assert(result.some((entry) => entry?.block), "confirm-all keeps the planning guard");

    await harness.commands.get("permission")("yolo", ctx);
    result = await harness.runHooks("tool_call", writeEvent("src/example.ts"), ctx);
    assert(!result.some((entry) => entry?.block), "YOLO deliberately bypasses the planning guard");

    await harness.commands.get("permission")("readonly", ctx);
    result = await harness.runHooks("tool_call", writeEvent(".agent/plans/current-plan.md"), ctx);
    assert(!result.some((entry) => entry?.block), "the plan file bypass works in readonly too");
    result = await harness.runHooks("tool_call", writeEvent("src/example.ts"), ctx);
    assert(result.some((entry) => entry?.block), "readonly still blocks other project writes");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
