/**
 * Permission-Extension: Transitionen, Menüs, harte Grenzen und Dialogdarstellung.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { assert, eq, test } from "./assertions.mjs";
import {
  createHarness,
  assertNoGlobalChrome,
  stripAnsi,
} from "../shared/harness.mjs";
import { load } from "./harness.mjs";

const permissionsExtension = await load("extensions/mode-permissions.ts");
const controlPlane = await load("extensions/control-plane.ts");
const permissionDialog = await load("extensions/shared/permission-dialog.ts");

await test("permission extension exposes transitions, menus and hard guards", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "pi-v3-permissions-"));
  const commands = new Map();
  const shortcuts = new Map();
  const hooks = new Map();
  const events = new Map();
  const appended = [];
  const statuses = [];
  const notifications = [];
  const selections = [];
  const sessionEntries = [
    {
      type: "custom",
      customType: "mode-permissions",
      data: { permissionLevel: "yolo" },
    },
  ];
  let workflowState = "idle";
  let workflowMode = "simple_plan";
  let thinking = "high";
  const add = (map, name, handler) => {
    const list = map.get(name) ?? [];
    list.push(handler);
    map.set(name, list);
    return () => {
      const index = list.indexOf(handler);
      if (index >= 0) list.splice(index, 1);
    };
  };
  const api = {
    events: {
      on(name, handler) {
        return add(events, name, handler);
      },
      emit(name, value) {
        for (const handler of events.get(name) ?? []) handler(value);
      },
    },
    on(name, handler) {
      add(hooks, name, handler);
    },
    registerCommand(name, options) {
      commands.set(name, options.handler);
    },
    registerShortcut(name, options) {
      shortcuts.set(name, options.handler);
    },
    appendEntry(type, data) {
      appended.push({ type, data });
    },
    getThinkingLevel() {
      return thinking;
    },
    setThinkingLevel(value) {
      thinking = value;
    },
  };
  const context = {
    cwd,
    mode: "tui",
    hasUI: true,
    model: {
      thinkingLevelMap: {
        minimal: 1,
        low: 1,
        medium: 1,
        high: 1,
        xhigh: 1,
      },
    },
    isProjectTrusted: () => true,
    sessionManager: {
      getSessionId: () => "permission-session",
      getEntries: () => sessionEntries,
    },
    ui: {
      getEditorText() {
        return "";
      },
      setEditorText() {},
      async submitSlashCommand(commandLine) {
        const match = /^\/([^\s]+)(?:\s+(.*))?$/.exec(commandLine);
        if (!match) throw new Error(`invalid slash command: ${commandLine}`);
        const handler = commands.get(match[1]);
        if (!handler) throw new Error(`unknown slash command: /${match[1]}`);
        await handler(match[2] ?? "", context);
      },
      setStatus(key, value) {
        statuses.push({ key, value });
      },
      notify(message, level) {
        notifications.push({ message, level });
      },
      async confirm() {
        return true;
      },
      async select() {
        return selections.shift();
      },
    },
  };
  const runHook = async (name, event = {}) => {
    const results = [];
    for (const handler of hooks.get(name) ?? []) {
      results.push(await handler(event, context));
    }
    return results;
  };
  try {
    permissionsExtension.default(api);
    if (controlPlane) controlPlane.default(api);
    api.events.on("workflow-capabilities:request", (request) => {
      request.respond({ state: workflowState, mode: workflowMode });
    });
    api.events.on("control-center:workflow-thinking-default", (request) => {
      request.respond({ mode: "work", defaultLevel: "medium" });
    });
    await runHook("session_start");
    api.events.emit("aurora-ui/state/request", {
      type: "request",
      requestId: "permission-state",
      sessionEpoch: "aurora-epoch",
      requester: "test",
    });
    assert(
      statuses.some((entry) => entry.value?.includes("PROJECT WRITE")),
      "persisted legacy yolo migrates to project-write without reactivating yolo",
    );
    const managedStateWrite = await runHook("tool_call", {
      toolName: "write",
      input: { path: ".agent/plans/current-plan.state.json" },
    });
    assert(
      managedStateWrite.some((entry) => entry?.block),
      "managed workflow artifacts are never writable through generic tools",
    );
    const managedUnknownTool = await runHook("tool_call", {
      toolName: "upload",
      input: { filePath: ".agent/direct-task.json" },
    });
    assert(
      managedUnknownTool.some((entry) => entry?.block),
      "unknown path-capable tools cannot bypass managed workflow artifacts",
    );
    await commands.get("permission")("read-bash", context);
    assert(
      statuses.at(-1).value.includes("READONLY"),
      "legacy command value migrates visibly to readonly",
    );
    const blockedWrite = await runHook("tool_call", {
      toolName: "write",
      input: { path: "src/a.ts" },
    });
    assert(
      blockedWrite.some((entry) => entry?.block),
      "readonly tool policy blocks project writes",
    );
    const blockedIdlePlanWrite = await runHook("tool_call", {
      toolName: "write",
      input: { path: ".agent/plans/current-plan.md" },
    });
    assert(
      blockedIdlePlanWrite.some((entry) => entry?.block),
      "readonly plan exception is inactive outside planning",
    );
    const blockedVerify = await runHook("tool_call", {
      toolName: "verify",
      input: { check: "test" },
    });
    assert(
      blockedVerify.some((entry) => entry?.block),
      "readonly blocks potentially mutating verification tools",
    );
    workflowState = "planning";
    const reviewerAllowed = await runHook("tool_call", {
      toolName: "subagent",
      input: { agent: "reviewer", task: "Review" },
    });
    assert(
      reviewerAllowed.every((entry) => entry === undefined),
      "planning capability permits the known read-only reviewer",
    );
    const planningPlanWrite = await runHook("tool_call", {
      toolName: "write",
      input: { path: ".agent/plans/current-plan.md" },
    });
    assert(
      planningPlanWrite.every((entry) => entry === undefined),
      "planning grants only the controlled current-plan write exception",
    );
    workflowState = "idle";
    await commands.get("permission")("confirm-all", context);
    const confirmedWrite = await runHook("tool_call", {
      toolName: "write",
      input: { path: "src/a.ts" },
    });
    assert(
      confirmedWrite.every((entry) => entry === undefined),
      "confirm-all permits a user-confirmed mutation",
    );
    workflowState = "working";
    const protectedPlanBash = await runHook("tool_call", {
      toolName: "bash",
      input: {
        command: "printf changed > .agent/plans/current-plan.md",
      },
    });
    assert(
      protectedPlanBash.some((entry) => entry?.block),
      "working blocks shell mutation of workflow artifacts",
    );
    const protectedDirectBash = await runHook("user_bash", {
      command: "rm .agent/plans/current-plan.state.json",
      cwd,
    });
    assert(
      protectedDirectBash.some((entry) => entry?.result?.exitCode === 126),
      "working also blocks direct shell mutation of workflow artifacts",
    );
    workflowState = "idle";
    await commands.get("yolo")("", context);
    const hardYoloBlock = await runHook("tool_call", {
      toolName: "bash",
      input: { command: "sudo true" },
    });
    assert(
      hardYoloBlock.some((entry) => entry?.block),
      "temporary yolo keeps the elevated-rights guard",
    );
    assert(
      appended
        .filter((entry) => entry.type === "mode-permissions")
        .every((entry) => entry.data.permissionLevel !== "yolo"),
      "yolo is never persisted as effective permission",
    );
    await shortcuts.get("super+y")(context);
    assert(
      !commands.get("full-access"),
      "the legacy /full-access alias with its own toggle logic is retired",
    );
    await commands.get("permission")("confirm-all", context);
    assert(
      statuses.at(-1).value.includes("CONFIRM ALL"),
      "/permission confirm-all selects confirm-all",
    );
    await commands.get("permission")("full-access", context);
    assert(
      statuses.at(-1).value.includes("CONFIRM ALL"),
      "the legacy value is still accepted at the /permission input boundary",
    );
    selections.push("Nur Lesen");
    for (const handler of events.get("control-center:open-permissions") ?? []) {
      await handler({ ctx: context });
    }
    selections.push(undefined);
    await shortcuts.get("super+d")(context);
    api.events.emit("workflow-capabilities:activated", {
      cwd,
      sessionId: "permission-session",
      mode: "simple_plan",
    });
    workflowMode = "simple_plan";
    assert(
      statuses.at(-1).value.includes("READONLY"),
      "workflow activation applies readonly planning default",
    );
    const shell = await runHook("user_bash", {
      command: "touch x",
      cwd,
    });
    assert(
      shell.some((entry) => entry?.result?.exitCode === 126),
      "readonly direct shell mutation is blocked",
    );
    await runHook("session_shutdown");
    assert(
      notifications.length > 0 &&
        appended.some((entry) => entry.type === "permission-transition"),
      "permission transitions stay visible and redacted in audit entries",
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

await test("permission dialog narrow rendering", async () => {
  if (!permissionDialog) return;
  const harness = createHarness({ columns: 24 });
  const context = harness.makeContext();
  const pending = permissionDialog.confirmAction(
    context,
    {
      action: "ask",
      reason: "This is a deliberately long confirmation reason for wrapping.",
      hard: true,
    },
    "rm -rf build-output",
    "bash",
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  const component = harness.customComponents.at(-1);
  assert(Boolean(component), "permission prompts use a temporary dialog");
  if (!component) return;
  assert(
    component.render(24).every((line) => stripAnsi(line).length <= 24),
    "permission dialog renders within a narrow 24-column terminal",
  );
  component.handleInput("d");
  eq(await pending, false, "permission dialog denies via keyboard");
  assertNoGlobalChrome(harness, "permission dialog installs no global chrome");
});
