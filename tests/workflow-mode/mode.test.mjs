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
import { createHarness } from "../shared/harness.mjs";
import { importModule as load } from "../shared/jiti-loader.mjs";

const planMode = await load("extensions/plan-mode/index.ts");

async function hooks(harness, name, ctx) {
  return harness.runHooks(name, {}, ctx);
}

await test("work is the default and ignores legacy sidecars", async () => {
  if (!planMode) return;
  const cwd = mkdtempSync(join(tmpdir(), "pi-mode-"));
  try {
    mkdirSync(join(cwd, ".agent", "plans"), { recursive: true });
    writeFileSync(
      join(cwd, ".agent", "plans", "current-plan.state.json"),
      '{"status":"blocked"}',
    );
    const harness = createHarness();
    const ctx = harness.makeContext({ cwd });
    planMode.default(harness.api);
    await hooks(harness, "session_start", ctx);
    const prompt = await hooks(harness, "before_agent_start", ctx);
    assert(
      prompt[0]?.message?.content.includes("PI WORKMODUS"),
      "session starts in work mode",
    );
    assert(
      !prompt[0]?.message?.content.includes("blocked"),
      "legacy sidecar is ignored",
    );
    await harness.commands.get("work")("", ctx);
    eq(
      harness.lifecycleCalls.filter((entry) => entry.kind === "confirm").length,
      0,
      "/work needs no confirmation",
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

await test("planning modes non-blockingly replace an existing plan without modal confirmation", async () => {
  if (!planMode) return;
  const cwd = mkdtempSync(join(tmpdir(), "pi-mode-"));
  try {
    mkdirSync(join(cwd, ".agent", "plans"), { recursive: true });
    const file = join(cwd, ".agent", "plans", "current-plan.md");
    writeFileSync(file, "# Freier alter Plan\n");
    const harness = createHarness({ confirm: () => { throw new Error("Confirm should not be called"); } });
    const ctx = harness.makeContext({ cwd });
    planMode.default(harness.api);
    await hooks(harness, "session_start", ctx);
    await harness.commands.get("plan")("detailed", ctx);
    eq(
      harness.lifecycleCalls.filter((entry) => entry.kind === "confirm").length,
      0,
      "zero overwrite confirmation prompts",
    );
    const prompt = await hooks(harness, "before_agent_start", ctx);
    assert(
      prompt[0]?.message?.content.includes("PI PLANMODUS"),
      "direct plan command enters plan mode non-blockingly",
    );
    assert(
      !prompt[0]?.message?.content.includes("## Abschlusskriterien"),
      "plan prompt has no contract section",
    );
    eq(
      harness.sent.length,
      1,
      "direct plan command starts one planning turn",
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

await test("workflow registers only the reduced command surface", () => {
  if (!planMode) return;
  const harness = createHarness();
  planMode.default(harness.api);
  for (const command of [
    "work",
    "go",
    "plan",
    "workflow",
    "view-plan",
    "show-plan",
    "edit-plan",
    "plan-edit",
  ]) {
    assert(harness.commands.has(command), `/${command} remains registered`);
  }
  for (const command of [
    "review-plan",
    "plan-todos",
    "done",
    "finish",
    "verify-gate",
    "task",
    "task-done",
    "migrate-plan",
    "recover-workflow-lock",
    "discard-plan",
  ]) {
    assert(!harness.commands.has(command), `/${command} is removed`);
  }
  assert(!harness.tools.has("plan_progress"), "plan_progress is removed");
});
