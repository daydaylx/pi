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
    eq(
      prompt[0],
      undefined,
      "an ordinary work turn adds nothing to the request at all",
    );
    assert(
      !prompt.some((entry) => entry?.systemPrompt?.includes("blocked")),
      "legacy sidecar is ignored",
    );
    assert(
      !prompt.some((entry) => entry?.message),
      "work mode injects no persisted custom message",
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

await test("workflow exposes no public slash commands or legacy shortcut", () => {
  if (!planMode) return;
  const harness = createHarness();
  planMode.default(harness.api);
  for (const command of ["plan", "work", "go", "workflow"]) {
    assert(!harness.commands.has(command), `/${command} is not registered`);
  }
  for (const command of ["view-plan", "edit-plan", "commands"]) {
    assert(harness.commands.has(command), `/${command} remains registered`);
  }
  for (const alias of ["show-plan", "plan-edit"]) {
    assert(!harness.commands.has(alias), `/${alias} alias is retired`);
  }
  assert(
    harness.shortcuts.has("shift+tab"),
    "Shift+Tab remains the only workflow control",
  );
  assert(
    !harness.shortcuts.has("super+p"),
    "Super+P no longer opens a workflow command",
  );
  assert(!harness.tools.has("plan_progress"), "plan_progress is removed");
});

await test("a run started by an extension message is not a planning turn", async () => {
  if (!planMode) return;
  const cwd = mkdtempSync(join(tmpdir(), "pi-mode-"));
  try {
    const harness = createHarness({ select: () => "Architekturplan" });
    const ctx = harness.makeContext({ cwd });
    planMode.default(harness.api);
    await hooks(harness, "session_start", ctx);
    await harness.shortcuts.get("shift+tab")(ctx);
    const custom = await harness.runHooks(
      "before_agent_start",
      { messageType: "custom", message: {}, systemPrompt: "SYS" },
      ctx,
    );
    assert(
      custom[0]?.systemPrompt?.startsWith("SYS\n\n"),
      "an extension-triggered run keeps the planning instructions",
    );
    assert(
      custom[0]?.message === undefined,
      "an extension-triggered run consumes no approval and injects no plan",
    );
    const user = await harness.runHooks(
      "before_agent_start",
      { messageType: "user", prompt: "Plane das", systemPrompt: "SYS" },
      ctx,
    );
    eq(
      custom[0].systemPrompt,
      user[0]?.systemPrompt,
      "both kinds of run carry the same planning prompt",
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

await test("choosing a plan mode preserves a plan until the next agent turn", async () => {
  if (!planMode) return;
  const cwd = mkdtempSync(join(tmpdir(), "pi-mode-"));
  try {
    const file = join(cwd, ".agent", "plans", "current-plan.md");
    mkdirSync(join(cwd, ".agent", "plans"), { recursive: true });
    writeFileSync(file, "# Freier alter Plan\n");
    const harness = createHarness({ select: () => "Architekturplan" });
    const ctx = harness.makeContext({ cwd });
    planMode.default(harness.api);
    await hooks(harness, "session_start", ctx);
    await harness.shortcuts.get("shift+tab")(ctx);
    assert(existsSync(file), "selection does not discard the plan");
    eq(harness.sent.length, 0, "selection does not start a planning turn");
    await hooks(harness, "before_agent_start", ctx);
    assert(
      existsSync(file),
      "the real planning turn preserves it until a successful replacement",
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
