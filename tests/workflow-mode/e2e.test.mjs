import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
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
const planPrompts = await load("extensions/plan-mode/prompts.ts");

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
      eq(
        latestStatus(harness, "workflow"),
        label,
        `${mode} is active after selection`,
      );
      eq(harness.sent.length, 0, "mode selection sends no synthetic prompt");
      assert(
        existsSync(planFilePath(cwd)),
        "mode selection preserves the plan",
      );

      const prompt = await hooks(harness, "before_agent_start", ctx);
      assert(
        prompt[0]?.systemPrompt?.includes(modeLabel),
        "the next real user turn receives planning context in its ephemeral system prompt",
      );
      eq(
        prompt[0]?.message,
        undefined,
        "the mode instruction is not a persisted custom message",
      );
      assert(
        existsSync(planFilePath(cwd)),
        "the old plan remains until a successful replacement exists",
      );
      eq(
        harness.sent.length,
        0,
        "the planning context does not synthesize a user message",
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
}

await test("planningPrompt() actively asks the agent to use ask_user for real decisions", async () => {
  if (!planPrompts) return;
  for (const mode of ["simple_plan", "detailed_plan"]) {
    const prompt = planPrompts.planningPrompt(mode);
    assert(
      prompt.includes("ask_user"),
      `${mode} planning prompt references the ask_user tool`,
    );
    assert(
      prompt.includes("ausdrücklich erwünscht"),
      `${mode} planning prompt encourages ask_user on real decisions, not just documenting them as options`,
    );
    assert(
      prompt.includes("einfacher, für Laien verständlicher Sprache"),
      `${mode} planning prompt requires plain-language options`,
    );
  }
});

await test("workPrompt() does not leak the planning-only ask_user hint into work mode", async () => {
  if (!planPrompts) return;
  const prompt = planPrompts.workPrompt("# Ein Plan\n");
  assert(
    !prompt.includes("ask_user"),
    "the work prompt is a separate template and never carries the planning-only ask_user hint",
  );
});

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
    assert(
      existsSync(planFilePath(cwd)),
      "work selection leaves the plan untouched",
    );
    const prompt = await hooks(harness, "before_agent_start", ctx);
    eq(
      prompt[0],
      undefined,
      "a work turn without a handoff adds no instruction of its own",
    );
    assert(
      !prompt.some((entry) =>
        entry?.systemPrompt?.includes("Bestehender Plan"),
      ),
      "a stale plan is not injected",
    );
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
    await harness.runHooks(
      "tool_result",
      {
        toolName: "write",
        input: { path: ".agent/plans/current-plan.md" },
        isError: false,
      },
      ctx,
    );
    await hooks(harness, "agent_settled", ctx);

    choice = "Work";
    await chooseWorkflow(harness, ctx);
    eq(harness.sent.length, 0, "switching to work still starts no turn");
    const handoff = await hooks(harness, "before_agent_start", ctx);
    assert(
      handoff[0]?.systemPrompt?.includes("Neuer Plan"),
      "the settled plan is included once",
    );
    assert(
      !handoff[0]?.systemPrompt?.includes("Zwischenstand vor Retry"),
      "an earlier low-level agent_end cannot freeze a retry intermediate",
    );

    await chooseWorkflow(harness, ctx);
    const later = await hooks(harness, "before_agent_start", ctx);
    eq(
      later[0],
      undefined,
      "Work → Work does not resurrect the handoff and adds nothing at all",
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

await test("a failed or missing planning result restores the old plan", async () => {
  if (!planMode) return;
  const cwd = mkdtempSync(join(tmpdir(), "pi-workflow-transaction-"));
  try {
    writePlan(cwd, "# Alter Plan\n");
    const harness = createHarness({ select: () => "Schnellplan" });
    const ctx = harness.makeContext({ cwd });
    planMode.default(harness.api);
    await hooks(harness, "session_start", ctx);
    await chooseWorkflow(harness, ctx);
    await hooks(harness, "before_agent_start", ctx);
    writePlan(cwd, "# Teilplan\n");
    await harness.runHooks(
      "tool_result",
      {
        toolName: "write",
        input: { path: ".agent/plans/current-plan.md" },
        isError: false,
      },
      ctx,
    );
    await harness.runHooks(
      "agent_end",
      { messages: [{ stopReason: "error", errorMessage: "provider failed" }] },
      ctx,
    );
    await hooks(harness, "agent_settled", ctx);
    eq(
      readFileSync(planFilePath(cwd), "utf8"),
      "# Alter Plan\n",
      "a failed plan run restores the old plan",
    );

    await hooks(harness, "before_agent_start", ctx);
    await hooks(harness, "agent_settled", ctx);
    eq(
      readFileSync(planFilePath(cwd), "utf8"),
      "# Alter Plan\n",
      "a missing replacement changes nothing",
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

await test("an aborted planning run restores the old plan and hands nothing off", async () => {
  if (!planMode) return;
  const cwd = mkdtempSync(join(tmpdir(), "pi-workflow-abort-"));
  try {
    writePlan(cwd, "# Alter Plan\n");
    let choice = "Schnellplan";
    const harness = createHarness({ select: () => choice });
    const ctx = harness.makeContext({ cwd });
    planMode.default(harness.api);
    await hooks(harness, "session_start", ctx);
    await chooseWorkflow(harness, ctx);
    await hooks(harness, "before_agent_start", ctx);

    writePlan(cwd, "# Halbfertiger Plan\n");
    await harness.runHooks(
      "tool_result",
      {
        toolName: "write",
        input: { path: ".agent/plans/current-plan.md" },
        isError: false,
      },
      ctx,
    );
    await harness.runHooks(
      "agent_end",
      { messages: [{ stopReason: "aborted" }] },
      ctx,
    );
    await hooks(harness, "agent_settled", ctx);
    eq(
      readFileSync(planFilePath(cwd), "utf8"),
      "# Alter Plan\n",
      "a user abort restores the plan that was there before the run",
    );

    choice = "Work";
    await chooseWorkflow(harness, ctx);
    const prompt = await hooks(harness, "before_agent_start", ctx);
    assert(
      !prompt[0]?.systemPrompt?.includes("Halbfertiger Plan"),
      "an aborted run hands off nothing",
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

await test("a failed plan write is not a successful replacement", async () => {
  if (!planMode) return;
  const cwd = mkdtempSync(join(tmpdir(), "pi-workflow-write-error-"));
  try {
    writePlan(cwd, "# Alter Plan\n");
    let choice = "Schnellplan";
    const harness = createHarness({ select: () => choice });
    const ctx = harness.makeContext({ cwd });
    planMode.default(harness.api);
    await hooks(harness, "session_start", ctx);
    await chooseWorkflow(harness, ctx);
    await hooks(harness, "before_agent_start", ctx);

    // The tool reported an error, but something left content behind anyway.
    writePlan(cwd, "# Kaputter Plan\n");
    await harness.runHooks(
      "tool_result",
      {
        toolName: "write",
        input: { path: ".agent/plans/current-plan.md" },
        isError: true,
      },
      ctx,
    );
    await hooks(harness, "agent_end", ctx);
    await hooks(harness, "agent_settled", ctx);
    eq(
      readFileSync(planFilePath(cwd), "utf8"),
      "# Alter Plan\n",
      "a write the tool reported as failed does not replace the plan",
    );

    choice = "Work";
    await chooseWorkflow(harness, ctx);
    const prompt = await hooks(harness, "before_agent_start", ctx);
    assert(
      !prompt[0]?.systemPrompt?.includes("Kaputter Plan"),
      "a failed write hands off nothing",
    );
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
    assert(
      !prompt[0]?.systemPrompt?.includes("Plan der alten Sitzung"),
      "resumed work ignores stale plan files",
    );
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
    let result = await harness.runHooks(
      "tool_call",
      writeEvent(".agent/plans/current-plan.md"),
      ctx,
    );
    assert(
      !result.some((entry) => entry?.block),
      "the plan file is auto-allowed",
    );
    result = await harness.runHooks(
      "tool_call",
      writeEvent("src/example.ts"),
      ctx,
    );
    assert(
      result.some((entry) => entry?.block),
      "other writes remain blocked while planning",
    );

    for (const event of [
      { toolName: "bash", input: { command: "npm test" } },
      { toolName: "bash", input: { command: "npm run build" } },
      { toolName: "project_check", input: { profile: "verify" } },
      {
        toolName: "subagent",
        input: { agent: "verifier", task: "x", output: "report.md" },
      },
    ]) {
      result = await harness.runHooks("tool_call", event, ctx);
      assert(
        result.some((entry) => entry?.block),
        `${event.toolName} cannot bypass Plan Mode`,
      );
    }
    for (const command of [
      "git status",
      "git diff",
      "git log",
      "rg plan extensions",
    ]) {
      result = await harness.runHooks(
        "tool_call",
        { toolName: "bash", input: { command } },
        ctx,
      );
      assert(
        !result.some((entry) => entry?.block),
        `${command} remains read-only in Plan Mode`,
      );
    }

    await harness.commands.get("permission")("confirm-all", ctx);
    result = await harness.runHooks(
      "tool_call",
      writeEvent("src/example.ts"),
      ctx,
    );
    assert(
      result.some((entry) => entry?.block),
      "confirm-all keeps the planning guard",
    );

    await harness.commands.get("permission")("yolo", ctx);
    result = await harness.runHooks(
      "tool_call",
      writeEvent("src/example.ts"),
      ctx,
    );
    assert(
      !result.some((entry) => entry?.block),
      "YOLO deliberately bypasses the planning guard",
    );

    await harness.commands.get("permission")("readonly", ctx);
    result = await harness.runHooks(
      "tool_call",
      writeEvent(".agent/plans/current-plan.md"),
      ctx,
    );
    assert(
      !result.some((entry) => entry?.block),
      "the plan file bypass works in readonly too",
    );
    result = await harness.runHooks(
      "tool_call",
      writeEvent("src/example.ts"),
      ctx,
    );
    assert(
      result.some((entry) => entry?.block),
      "readonly still blocks other project writes",
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
