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

// This case writes the plan directly via the test helper and never calls
// /plan — it only exercises /go's handoff. The full /plan -> /go path,
// including that /plan discards a stale plan, is covered by Test 1/2 below.
await test("Fall A: /go hands a pre-written plan to work exactly once", async () => {
  if (!planMode) return;
  const cwd = mkdtempSync(join(tmpdir(), "pi-go-handoff-"));
  try {
    const harness = createHarness();
    const ctx = harness.makeContext({ cwd });
    planMode.default(harness.api);
    await hooks(harness, "session_start", ctx);

    // Simulate the plan a prior planning turn would have written.
    writePlan(cwd, "# Plan\n\n## Ziel\nBeispielziel\n");

    await harness.commands.get("go")("", ctx);

    eq(harness.sent.length, 1, "/go starts exactly one implementation turn");
    eq(
      harness.sent[0].options?.triggerTurn,
      true,
      "/go's message triggers a turn",
    );
    assert(
      harness.sent[0].message.content.includes("Beispielziel"),
      "the handoff message carries the plan content",
    );
    assert(
      harness.sent[0].message.content.includes(
        "Setze den aktuellen Plan jetzt um",
      ),
      "the handoff message tells the agent to implement the plan now",
    );

    const prompt = await hooks(harness, "before_agent_start", ctx);
    assert(
      prompt[0]?.message?.content.includes("PI WORKMODUS"),
      "/go switched the session into work mode",
    );

    const nextPrompt = await hooks(harness, "before_agent_start", ctx);
    assert(
      !nextPrompt[0]?.message?.content.includes("Beispielziel"),
      "a later work turn does not automatically receive the plan again",
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

await test("Fall B: a stale plan file is not injected into a normal work turn", async () => {
  if (!planMode) return;
  const cwd = mkdtempSync(join(tmpdir(), "pi-stale-plan-"));
  try {
    writePlan(cwd, "# Alter Plan aus vorheriger Aufgabe\n");
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
      !prompt[0]?.message?.content.includes("Alter Plan"),
      "an existing plan file from a previous task is not injected into a normal work turn",
    );

    await harness.commands.get("work")("", ctx);
    const afterWork = await hooks(harness, "before_agent_start", ctx);
    assert(
      !afterWork[0]?.message?.content.includes("Alter Plan"),
      "/work does not pull in the stale plan either",
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

await test("Fall C: /go without a plan gives a clear message and starts no turn", async () => {
  if (!planMode) return;
  const cwd = mkdtempSync(join(tmpdir(), "pi-go-no-plan-"));
  try {
    const harness = createHarness();
    const ctx = harness.makeContext({ cwd });
    planMode.default(harness.api);
    await hooks(harness, "session_start", ctx);

    await harness.commands.get("go")("", ctx);

    eq(harness.sent.length, 0, "/go starts no turn without a plan");
    assert(
      harness.notifications.some((entry) =>
        entry.message.includes("Kein aktueller Plan vorhanden"),
      ),
      "/go tells the user clearly that no plan exists",
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

await test("Fall D: /workflow only selects a mode, /plan starts a planning turn", async () => {
  if (!planMode) return;
  const cwd = mkdtempSync(join(tmpdir(), "pi-workflow-vs-plan-"));
  try {
    const harness = createHarness({
      select: (labels) =>
        labels.find((label) => label.includes("Architekturplan")),
    });
    const ctx = harness.makeContext({ cwd });
    planMode.default(harness.api);
    await hooks(harness, "session_start", ctx);

    await harness.commands.get("workflow")("", ctx);
    eq(
      harness.sent.length,
      0,
      "/workflow only switches mode, it never starts a turn",
    );
    const prompt = await hooks(harness, "before_agent_start", ctx);
    assert(
      prompt[0]?.message?.content.includes("PI PLANMODUS"),
      "/workflow did switch into a planning mode",
    );

    await harness.commands.get("work")("", ctx);
    await harness.commands.get("plan")("detailed", ctx);
    eq(
      harness.sent.length,
      1,
      "/plan detailed starts exactly one planning turn",
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

await test("Fall E: Soft Plan Mode — the plan file bypass is independent of the permission level", async () => {
  if (!planMode || !modePermissions) return;
  const cwd = mkdtempSync(join(tmpdir(), "pi-soft-plan-mode-"));
  try {
    const harness = createHarness();
    planMode.default(harness.api);
    modePermissions.default(harness.api);
    const ctx = harness.makeContext({ cwd });
    await hooks(harness, "session_start", ctx);
    await harness.commands.get("plan")("detailed", ctx);

    const writeEvent = (path) => ({ toolName: "write", input: { path } });

    // project-write (the default level): the plan file bypasses the level entirely.
    let result = await harness.runHooks(
      "tool_call",
      writeEvent(".agent/plans/current-plan.md"),
      ctx,
    );
    assert(
      !result.some((entry) => entry?.block),
      "plan file writes are auto-allowed under project-write",
    );

    // project-write: an ordinary project write is unaffected by the planning mode.
    result = await harness.runHooks(
      "tool_call",
      writeEvent("src/example.ts"),
      ctx,
    );
    assert(
      !result.some((entry) => entry?.block),
      "an ordinary write follows the (permissive) project-write level",
    );

    // Switch to readonly: only the plan file keeps its automatic bypass.
    await harness.commands.get("permission")("readonly", ctx);

    result = await harness.runHooks(
      "tool_call",
      writeEvent(".agent/plans/current-plan.md"),
      ctx,
    );
    assert(
      !result.some((entry) => entry?.block),
      "the plan file bypass does not depend on the chosen permission level",
    );

    result = await harness.runHooks(
      "tool_call",
      writeEvent("src/example.ts"),
      ctx,
    );
    assert(
      result.some((entry) => entry?.block),
      "readonly still blocks ordinary writes even in a planning mode: Plan Mode is not a read-only sandbox by itself",
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

await test("Test 1: /plan discards a stale plan before the new planning turn; a turn that writes nothing leaves /go with none", async () => {
  if (!planMode) return;
  const cwd = mkdtempSync(join(tmpdir(), "pi-plan-discard-"));
  try {
    writePlan(cwd, "# Alter Plan\n");
    const harness = createHarness();
    const ctx = harness.makeContext({ cwd });
    planMode.default(harness.api);
    await hooks(harness, "session_start", ctx);

    await harness.commands.get("plan")("detailed", ctx);

    eq(
      harness.sent.length,
      1,
      "/plan detailed starts exactly one planning turn",
    );
    assert(
      !existsSync(planFilePath(cwd)),
      "the stale plan is discarded once the new planning turn starts",
    );

    // The planning turn is simulated as having aborted: no new plan written.
    await harness.commands.get("go")("", ctx);

    eq(
      harness.sent.length,
      1,
      "/go starts no implementation turn: the planning turn above is still the only one sent",
    );
    assert(
      harness.notifications.some((entry) =>
        entry.message.includes("Kein aktueller Plan vorhanden"),
      ),
      "/go refuses to fall back to the discarded plan",
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

await test("Test 2: /plan discards the old plan, and /go hands over only the freshly written one", async () => {
  if (!planMode) return;
  const cwd = mkdtempSync(join(tmpdir(), "pi-plan-replace-"));
  try {
    writePlan(cwd, "# Alter Plan\n");
    const harness = createHarness();
    const ctx = harness.makeContext({ cwd });
    planMode.default(harness.api);
    await hooks(harness, "session_start", ctx);

    await harness.commands.get("plan")("detailed", ctx);
    assert(
      !existsSync(planFilePath(cwd)),
      "the old plan is removed once the new planning turn starts",
    );

    // Simulate the planning turn actually writing a fresh plan.
    writePlan(cwd, "# Neuer Plan\n\n## Ziel\nNeues Ziel\n");

    await harness.commands.get("go")("", ctx);

    eq(
      harness.sent.length,
      2,
      "/plan's planning turn plus /go's implementation turn",
    );
    const handoff = harness.sent[1];
    assert(
      handoff.message.content.includes("Neuer Plan") &&
        handoff.message.content.includes("Neues Ziel"),
      "/go hands over the freshly written plan",
    );
    assert(
      !handoff.message.content.includes("Alter Plan"),
      "the discarded old plan never resurfaces",
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

await test("Test 3: /workflow does not discard an existing plan", async () => {
  if (!planMode) return;
  const cwd = mkdtempSync(join(tmpdir(), "pi-workflow-keeps-plan-"));
  try {
    writePlan(cwd, "# Bestehender Plan\n");
    const harness = createHarness({
      select: (labels) =>
        labels.find((label) => label.includes("Architekturplan")),
    });
    const ctx = harness.makeContext({ cwd });
    planMode.default(harness.api);
    await hooks(harness, "session_start", ctx);

    await harness.commands.get("workflow")("", ctx);

    eq(harness.sent.length, 0, "/workflow starts no planning turn");
    assert(
      existsSync(planFilePath(cwd)),
      "/workflow leaves an existing plan file untouched",
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

await test("Test 4: /work does not discard or inject an existing plan", async () => {
  if (!planMode) return;
  const cwd = mkdtempSync(join(tmpdir(), "pi-work-keeps-plan-"));
  try {
    writePlan(cwd, "# Bestehender Plan\n");
    const harness = createHarness();
    const ctx = harness.makeContext({ cwd });
    planMode.default(harness.api);
    await hooks(harness, "session_start", ctx);

    await harness.commands.get("work")("", ctx);

    assert(
      existsSync(planFilePath(cwd)),
      "/work leaves an existing plan file untouched",
    );
    const prompt = await hooks(harness, "before_agent_start", ctx);
    assert(
      !prompt[0]?.message?.content.includes("Bestehender Plan"),
      "/work still does not inject the plan into the turn",
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

