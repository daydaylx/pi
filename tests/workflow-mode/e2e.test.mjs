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

// The handoff is transition-based: it only fires when the previous mode was
// a planning mode, so the plan has to come from an actual /plan turn (as a
// real planning turn would produce it), not from a file dropped in place
// while the session was already in work mode. The full /plan -> /go path,
// including that /plan discards a stale plan, is covered by Test 1/2 below.
await test("Fall A: /go hands a freshly planned plan to work exactly once", async () => {
  if (!planMode) return;
  const cwd = mkdtempSync(join(tmpdir(), "pi-go-handoff-"));
  try {
    const harness = createHarness();
    const ctx = harness.makeContext({ cwd });
    planMode.default(harness.api);
    await hooks(harness, "session_start", ctx);

    await harness.commands.get("plan")("detailed", ctx);
    // Simulate the planning turn actually writing its plan.
    writePlan(cwd, "# Plan\n\n## Ziel\nBeispielziel\n");

    await harness.commands.get("go")("", ctx);

    eq(
      harness.sent.length,
      2,
      "/plan's planning turn plus /go's implementation turn",
    );
    const handoff = harness.sent[1];
    eq(handoff.options?.triggerTurn, true, "/go's message triggers a turn");
    assert(
      handoff.message.content.includes("Beispielziel"),
      "the handoff message carries the plan content",
    );
    assert(
      handoff.message.content.includes("Setze den aktuellen Plan jetzt um"),
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

await test("Fall D: /workflow (Shift+Tab) changes only the mode and waits for user input", async () => {
  if (!planMode) return;
  const cwd = mkdtempSync(join(tmpdir(), "pi-workflow-mode-only-"));
  try {
    let selectCalls = 0;
    const harness = createHarness({
      select: (labels) => {
        selectCalls += 1;
        return selectCalls === 1
          ? labels.find((label) => label.includes("Architekturplan"))
          : labels.find((label) => label === "Work");
      },
    });
    const ctx = harness.makeContext({ cwd });
    planMode.default(harness.api);
    await hooks(harness, "session_start", ctx);
    writePlan(cwd, "# Bestehender Plan\n\n## Ziel\nBleibt erhalten\n");

    // Shift+Tab -> Workflow -> Architekturplan changes the context, but does
    // not submit an agent message. The user's next input owns that turn.
    await harness.commands.get("workflow")("", ctx);
    eq(
      harness.sent.length,
      0,
      "/workflow changes to a planning mode without starting a turn",
    );
    assert(existsSync(planFilePath(cwd)), "/workflow keeps an existing plan");
    const planPrompt = await hooks(harness, "before_agent_start", ctx);
    assert(
      planPrompt[0]?.message?.content.includes("PI PLANMODUS"),
      "the next user-started turn receives the selected planning mode",
    );

    // Switching back to Work likewise does not inject a plan or start a turn.
    await harness.commands.get("workflow")("", ctx);
    eq(
      harness.sent.length,
      0,
      "/workflow switching to work does not start a handoff turn",
    );
    assert(
      existsSync(planFilePath(cwd)),
      "/workflow switching to work does not modify the existing plan",
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

await test("Fall E: Plan Mode mutation guard — technical enforcement at project-write/confirm-all, plan file always writable, YOLO bypasses", async () => {
  if (!planMode || !modePermissions) return;
  const cwd = mkdtempSync(join(tmpdir(), "pi-plan-mode-guard-"));
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

    // project-write: an ordinary project write is now technically blocked while planning.
    result = await harness.runHooks(
      "tool_call",
      writeEvent("src/example.ts"),
      ctx,
    );
    assert(
      result.some((entry) => entry?.block),
      "the plan-mode mutation guard blocks an ordinary write at project-write while planning",
    );

    // confirm-all: same technical guard applies.
    await harness.commands.get("permission")("confirm-all", ctx);
    result = await harness.runHooks(
      "tool_call",
      writeEvent("src/example.ts"),
      ctx,
    );
    assert(
      result.some((entry) => entry?.block),
      "the plan-mode mutation guard also blocks an ordinary write at confirm-all while planning",
    );

    // YOLO: an explicit, deliberate override the plan guard does not second-guess.
    await harness.commands.get("permission")("yolo", ctx);
    result = await harness.runHooks(
      "tool_call",
      writeEvent("src/example.ts"),
      ctx,
    );
    assert(
      !result.some((entry) => entry?.block),
      "YOLO bypasses the plan-mode mutation guard",
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
      "readonly still blocks ordinary writes even in a planning mode: readonly needs no separate guard handling",
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

await test("Test 3: /workflow keeps an existing plan because it only changes mode", async () => {
  if (!planMode) return;
  const cwd = mkdtempSync(join(tmpdir(), "pi-workflow-keeps-plan-"));
  try {
    writePlan(cwd, "# Alter Plan\n");
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
      "/workflow starting a planning mode waits for user input",
    );
    assert(
      existsSync(planFilePath(cwd)),
      "/workflow does not discard a plan before a user starts a new planning turn",
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
