import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assert, eq, test } from "../shared/assertions.mjs";
import { createHarness, latestStatus } from "../shared/harness.mjs";
import { importModule as load } from "../shared/jiti-loader.mjs";

const modePermissions = await load("extensions/mode-permissions.ts");

async function hooks(harness, name, ctx, event = {}) {
  return harness.runHooks(name, event, ctx);
}

function answerRecoveryClear(harness) {
  harness.api.events.on("recovery-status:request", (request) =>
    request.respond({ armed: false }),
  );
}

// The permission layer is self-sufficient: no workflow provider (there is no
// planning workflow any more) is needed, and none may be asked for.
await test("permissions decide without any workflow provider and never ask for one", async () => {
  if (!modePermissions) return;
  const cwd = mkdtempSync(join(tmpdir(), "pi-no-workflow-"));
  try {
    const harness = createHarness();
    answerRecoveryClear(harness);
    let asked = 0;
    harness.api.events.on("workflow-capabilities:request", () => {
      asked += 1;
    });
    modePermissions.default(harness.api);
    const ctx = harness.makeContext({ cwd });
    await hooks(harness, "session_start", ctx);

    const write = () =>
      harness.runHooks(
        "tool_call",
        { toolName: "write", input: { path: "src/example.ts" } },
        ctx,
      );
    assert(
      !(await write()).some((entry) => entry?.block),
      "a project write is decided by the permission level alone",
    );

    for (const [arg, status] of [
      ["", "⚠ YOLO · TEMPORÄR"],
      ["", "🛡 DEFAULT · PROJECT WRITE"],
      ["2", "⚠ YOLO 2 · MIT RÜCKFRAGE"],
      ["3", "⚠ YOLO 3 · VOLLZUGRIFF"],
    ]) {
      await harness.commands.get("yolo")(arg, ctx);
      eq(
        latestStatus(harness, "permissions"),
        status,
        `/yolo ${arg} works without a workflow provider`,
      );
    }
    eq(
      harness.appended.filter(
        (entry) => entry.customType === "permission-transition-denied",
      ).length,
      0,
      "no YOLO transition is denied for want of a workflow state",
    );
    assert(
      !(await write()).some((entry) => entry?.block),
      "YOLO 3 writes without a dialog and without a workflow provider",
    );
    eq(asked, 0, "the permission layer never queries a workflow provider");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

await test("selecting a new thinking level persists it in the mode-permissions record", async () => {
  if (!modePermissions) return;
  const cwd = mkdtempSync(join(tmpdir(), "pi-thinking-persist-"));
  try {
    const harness = createHarness();
    modePermissions.default(harness.api);
    const ctx = harness.makeContext({ cwd });
    await hooks(harness, "session_start", ctx);

    // session_start's own restore flow already persists once with the
    // harness's default thinking level ("high"); only a change away from
    // that proves the live thinking_level_select -> onPersist path fired,
    // not the restore echo (which onPersist deliberately skips).
    await harness.runHooks(
      "thinking_level_select",
      { level: "medium", previousLevel: "high" },
      ctx,
    );

    const persisted = harness.appended
      .filter(
        (entry) =>
          entry.type === "custom" && entry.customType === "mode-permissions",
      )
      .at(-1);
    assert(
      persisted?.data.manualThinkingLevel === "medium",
      "a live thinking-level change is persisted in the shared mode-permissions record",
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

await test("guard limits subagent launches to 3 per parent run and resets per turn", async () => {
  if (!modePermissions) return;
  {
    const cwd = mkdtempSync(join(tmpdir(), "pi-parent-run-limit-"));
    try {
      const harness = createHarness();
      answerRecoveryClear(harness);
      modePermissions.default(harness.api);
      const ctx = harness.makeContext({ cwd });
      await hooks(harness, "session_start", ctx);
      const launch = () =>
        harness.runHooks(
          "tool_call",
          {
            toolName: "subagent",
            input: {
              spec: {
                objective: "Analyse one area",
                profile: "analyse",
                delegationReason: "independent analysis",
              },
            },
          },
          ctx,
        );
      for (let i = 1; i <= 3; i++) {
        assert(
          !(await launch()).some((entry) => entry?.block),
          `agent ${i} of the parent run is admitted`,
        );
      }
      const fourth = await launch();
      assert(
        fourth.some((entry) => entry?.block && /3 Subagenten/.test(entry.reason)),
        "the 4th agent of the same parent run is blocked",
      );
      await hooks(harness, "agent_start", ctx);
      assert(
        !(await launch()).some((entry) => entry?.block),
        "a new parent run (agent_start) starts with a fresh count",
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }
});

await test("/yolo selects between three stufen, never persists them and YOLO 3 writes without a dialog", async () => {
  if (!modePermissions) return;
  {
    const cwd = mkdtempSync(join(tmpdir(), "pi-yolo-stufen-e2e-"));
    try {
      const harness = createHarness();
      answerRecoveryClear(harness);
      modePermissions.default(harness.api);
      const ctx = harness.makeContext({ cwd });
      await hooks(harness, "session_start", ctx);
      const yolo = (args) => harness.commands.get("yolo")(args, ctx);
      const status = () => latestStatus(harness, "permissions");
      const write = async () =>
        harness.runHooks(
          "tool_call",
          { toolName: "write", input: { path: "src/example.ts" } },
          ctx,
        );

      await yolo("2");
      eq(status(), "⚠ YOLO 2 · MIT RÜCKFRAGE", "/yolo 2 enters stufe 2");
      await yolo("3");
      eq(status(), "⚠ YOLO 3 · VOLLZUGRIFF", "/yolo 3 switches to stufe 3");
      await yolo("1");
      eq(status(), "⚠ YOLO · TEMPORÄR", "/yolo 1 switches back to stufe 1");
      await yolo("3");
      await yolo("3");
      eq(
        status(),
        "🛡 DEFAULT · PROJECT WRITE",
        "the active stufe again turns YOLO off",
      );
      await yolo("full");
      await yolo("off");
      eq(status(), "🛡 DEFAULT · PROJECT WRITE", "/yolo off leaves YOLO");
      await yolo("");
      eq(status(), "⚠ YOLO · TEMPORÄR", "bare /yolo still toggles stufe 1");
      await yolo("");
      await yolo("off");
      assert(
        harness.notifications.some((entry) =>
          entry.message.includes("nicht aktiv"),
        ),
        "/yolo off without an active YOLO says so instead of enabling it",
      );
      eq(status(), "🛡 DEFAULT · PROJECT WRITE", "/yolo off stays off");
      await yolo("7");
      eq(
        status(),
        "🛡 DEFAULT · PROJECT WRITE",
        "an unknown stufe changes nothing",
      );

      await harness.commands.get("permission")("yolo-full", ctx);
      eq(status(), "⚠ YOLO 3 · VOLLZUGRIFF", "/permission yolo-full works too");

      const persisted = harness.appended
        .filter((entry) => entry.customType === "mode-permissions")
        .map((entry) => entry.data.selectedPermissionLevel);
      assert(
        persisted.every((level) => level === "project-write"),
        "a YOLO stufe is never persisted as the selected level",
      );

      const result = await write();
      assert(
        !result.some((entry) => entry?.block),
        "YOLO 3 writes without a dialog",
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }
});

await test("YOLO 2 shows the confirm dialog at a boundary and a rejection blocks; YOLO 3 skips it", async () => {
  if (!modePermissions) return;
  {
    const cwd = mkdtempSync(join(tmpdir(), "pi-yolo-dialog-"));
    try {
      const run = async (level, approve, toolName, input) => {
        const harness = createHarness({ confirm: approve });
        answerRecoveryClear(harness);
        modePermissions.default(harness.api);
        const ctx = harness.makeContext({ cwd });
        // Deterministic confirm fallback instead of the custom overlay.
        ctx.ui.custom = async () => {
          throw new Error("use deterministic confirm fallback");
        };
        await hooks(harness, "session_start", ctx);
        await harness.commands.get("yolo")(level, ctx);
        const result = await harness.runHooks(
          "tool_call",
          { toolName, input },
          ctx,
        );
        const asked = harness.lifecycleCalls.filter(
          (call) => call.kind === "confirm",
        ).length;
        return { blocked: result.some((entry) => entry?.block), asked };
      };
      const cases = [
        ["bash", { command: "sudo id" }],
        ["bash", { command: "cat ~/.ssh/id_rsa" }],
        ["read", { path: "~/.ssh/id_rsa" }],
        ["write", { path: "/etc/pi-yolo-dialog-test" }],
      ];
      for (const [toolName, input] of cases) {
        const label = `${toolName} ${JSON.stringify(input)}`;
        const approved = await run("2", true, toolName, input);
        assert(
          !approved.blocked && approved.asked >= 1,
          `YOLO 2 asks and runs after approval: ${label}`,
        );
        const rejected = await run("2", false, toolName, input);
        assert(
          rejected.blocked && rejected.asked >= 1,
          `YOLO 2 blocks after a rejected dialog: ${label}`,
        );
        const full = await run("3", false, toolName, input);
        assert(
          !full.blocked && !full.asked,
          `YOLO 3 runs without any dialog: ${label}`,
        );
        const one = await run("1", true, toolName, input);
        assert(
          one.blocked && !one.asked,
          `YOLO 1 still blocks silently: ${label}`,
        );
      }
      const routine = await run("2", false, "bash", { command: "git status" });
      assert(
        !routine.blocked && !routine.asked,
        "YOLO 2 stays dialog-free for routine commands",
      );
      const ordinaryRead = await run("2", false, "read", {
        path: "/etc/hostname",
      });
      assert(
        !ordinaryRead.blocked && !ordinaryRead.asked,
        "YOLO 2 allows ordinary external reads without dialog",
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }
});
