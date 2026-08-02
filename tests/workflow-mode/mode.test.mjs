import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
    writeFileSync(join(cwd, ".agent", "plans", "current-plan.state.json"), '{"status":"blocked"}');
    const harness = createHarness();
    const ctx = harness.makeContext({ cwd });
    planMode.default(harness.api);
    await hooks(harness, "session_start", ctx);
    const prompt = await hooks(harness, "before_agent_start", ctx);
    assert(prompt[0]?.message?.content.includes("PI WORKMODUS"), "session starts in work mode");
    assert(!prompt[0]?.message?.content.includes("blocked"), "legacy sidecar is ignored");
    await harness.commands.get("work")("", ctx);
    eq(harness.lifecycleCalls.filter((entry) => entry.kind === "confirm").length, 0, "/work needs no confirmation");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

await test("planning modes ask once before replacing an existing plan", async () => {
  if (!planMode) return;
  const cwd = mkdtempSync(join(tmpdir(), "pi-mode-"));
  try {
    mkdirSync(join(cwd, ".agent", "plans"), { recursive: true });
    const file = join(cwd, ".agent", "plans", "current-plan.md");
    writeFileSync(file, "# Freier alter Plan\n");
    let accepted = false;
    const harness = createHarness({ confirm: () => accepted });
    const ctx = harness.makeContext({ cwd });
    planMode.default(harness.api);
    await hooks(harness, "session_start", ctx);
    await harness.commands.get("plan")("simple", ctx);
    eq(harness.lifecycleCalls.filter((entry) => entry.kind === "confirm").length, 1, "exactly one overwrite confirmation");
    const declinedPrompt = await hooks(harness, "before_agent_start", ctx);
    assert(declinedPrompt[0]?.message?.content.includes("PI WORKMODUS"), "declining leaves work active");
    eq(existsSync(file), true, "declining does not change the plan file");
    eq(harness.sent.length, 0, "declining starts no planning turn");
    accepted = true;
    await harness.commands.get("plan")("detailed", ctx);
    const prompt = await hooks(harness, "before_agent_start", ctx);
    assert(prompt[0]?.message?.content.includes("PI PLANMODUS"), "accepted selection enters plan mode");
    assert(!prompt[0]?.message?.content.includes("## Abschlusskriterien"), "plan prompt has no contract section");
    eq(harness.sent.length, 1, "accepted direct plan command starts one planning turn");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

await test("workflow registers only the reduced command surface", () => {
  if (!planMode) return;
  const harness = createHarness();
  planMode.default(harness.api);
  for (const command of ["work", "go", "plan", "workflow", "view-plan", "show-plan", "edit-plan", "plan-edit"]) {
    assert(harness.commands.has(command), `/${command} remains registered`);
  }
  for (const command of ["review-plan", "plan-todos", "done", "finish", "verify-gate", "task", "task-done", "migrate-plan", "recover-workflow-lock", "discard-plan"]) {
    assert(!harness.commands.has(command), `/${command} is removed`);
  }
  assert(!harness.tools.has("plan_progress"), "plan_progress is removed");
});
