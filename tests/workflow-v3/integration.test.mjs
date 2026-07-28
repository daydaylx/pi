/**
 * Extension-Entry: Plan, Arbeit, Completion, Direct Task und Recovery im Verbund.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { assert, equal, test } from "./assertions.mjs";
import { quickPlan } from "../shared/plan-fixtures.mjs";
import { load } from "./harness.mjs";

const snapshotMod = await load("extensions/plan-mode/plan-snapshot.ts");
const store = await load("extensions/plan-mode/store/index.ts");
const execution = await load("extensions/plan-mode/execution.ts");
const planExtension = await load("extensions/plan-mode/index.ts");

await test("extension entry drives plan, work, completion, direct task and recovery", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "pi-v3-integration-"));
  const commands = new Map();
  const tools = new Map();
  const shortcuts = new Map();
  const hooks = new Map();
  const events = new Map();
  const notifications = [];
  const sent = [];
  const appended = [];
  const inputQueue = [];
  const selectQueue = [];
  let verificationFails = false;
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
      on(name, handler) { return add(events, name, handler); },
      emit(name, value) {
        for (const handler of events.get(name) ?? []) handler(value);
        if (name === "lsp:diagnostics:v1:request") {
          value.respond({
            version: 1,
            requestId: value.requestId,
            results: value.files.map((file) => ({
              path: file,
              status: "pass",
              summary: "clean",
            })),
          });
        }
        if (name === "subagents:rpc:v1:request") {
          const reply = `subagents:rpc:v1:reply:${value.requestId}`;
          queueMicrotask(() => {
            api.events.emit(
              reply,
              value.method === "spawn"
                ? { success: true, data: { runId: "integration-review" } }
                : {
                    success: true,
                    data: {
                      state: "completed",
                      results: [
                        {
                          output:
                            "Keine Befunde.\n[COMPLETION-REVIEW:PASS]",
                        },
                      ],
                    },
                  },
            );
          });
        }
      },
    },
    on(name, handler) { add(hooks, name, handler); },
    registerFlag() {},
    registerCommand(name, options) { commands.set(name, options.handler); },
    registerTool(tool) { tools.set(tool.name, tool); },
    registerShortcut(name, options) { shortcuts.set(name, options.handler); },
    getFlag() { return false; },
    appendEntry(type, data) { appended.push({ type, data }); },
    sendMessage(message) { sent.push(message); },
    async exec(program, args) {
      const joined = args.join(" ");
      if (joined.startsWith("status ")) {
        return {
          code: 0,
          stdout: " M extensions/plan-mode/a.ts\n",
          stderr: "",
          killed: false,
        };
      }
      if (joined === "diff --stat HEAD") {
        return { code: 0, stdout: " 1 file changed\n", stderr: "", killed: false };
      }
      if (joined === "diff --binary HEAD") {
        return {
          code: 0,
          stdout: "diff --git a/a b/a\n+ok\n",
          stderr: "",
          killed: false,
        };
      }
      if (verificationFails && program !== "git") {
        return {
          code: 1,
          stdout: "",
          stderr: "intentional verification failure",
          killed: false,
        };
      }
      return { code: 0, stdout: "", stderr: "", killed: false };
    },
  };
  const context = {
    cwd,
    mode: "tui",
    hasUI: true,
    isProjectTrusted: () => true,
    isIdle: () => true,
    sessionManager: {
      getSessionId: () => "integration-session",
      getEntries: () => [],
    },
    ui: {
      notify(message, level) { notifications.push({ message, level }); },
      setStatus() {},
      async select() { return selectQueue.shift(); },
      async confirm() { return true; },
      async input() { return inputQueue.shift(); },
    },
  };
  const runHook = async (name) => {
    const results = [];
    for (const handler of hooks.get(name) ?? []) {
      results.push(await handler({}, context));
    }
    return results;
  };
  try {
    planExtension.default(api);
    await runHook("session_start");
    mkdirSync(path.join(cwd, ".pi"), { recursive: true });
    writeFileSync(
      path.join(cwd, ".pi", "verify.json"),
      JSON.stringify({
        profiles: {
          typecheck: {
            program: "npm",
            args: ["run", "typecheck"],
            classification: "required",
          },
        },
      }),
    );
  for (const command of [
    "plan",
    "review-plan",
    "work",
    "done",
    "finish",
    "task",
    "task-done",
    "migrate-plan",
  ]) {
      assert(commands.has(command), `/${command} is registered`);
  }
    assert(tools.has("plan_progress"), "plan_progress is registered");
    assert(shortcuts.has("shift+tab"), "Shift+Tab control center remains");

    await commands.get("plan")("quick", context);
    const planningContext = await runHook("before_agent_start");
    assert(
      planningContext.some((entry) =>
        entry?.message?.content?.includes("PI WORKFLOW: PLANUNG"),
      ),
      "planning prompt is injected",
    );
    mkdirSync(path.join(cwd, ".agent", "plans"), { recursive: true });
    writeFileSync(path.join(cwd, store.PLAN_RELATIVE_PATH), quickPlan());
    await runHook("agent_settled");
    let loaded = store.loadWorkflowStateV3(cwd);
    assert(Boolean(loaded.snapshot), "agent settlement finalizes PlanSnapshot v3");

    await commands.get("plan-todos")("", context);
    await commands.get("review-plan")("", context);
    await runHook("before_agent_start");
    await runHook("agent_settled");
    await commands.get("work")("", context);
    const workContext = await runHook("before_agent_start");
    assert(
      workContext.some((entry) =>
        entry?.message?.content?.includes("PI WORKFLOW: AUSFÜHRUNG"),
      ),
      "working prompt is injected",
    );
    loaded = store.loadWorkflowStateV3(cwd);
    for (const [index, step] of loaded.snapshot.steps.entries()) {
      if (index === 0) {
        await tools.get("plan_progress").execute(
          "progress-start",
          {
            stepId: step.id,
            status: "in_progress",
            evidence: "started",
          },
          undefined,
          undefined,
          context,
        );
      }
      await tools.get("plan_progress").execute(
        `progress-${index}`,
        {
          stepId: step.id,
          status: "completed",
          evidence: "passed",
        },
        undefined,
        undefined,
        context,
      );
    }
    await runHook("agent_settled");
    assert(
      !existsSync(path.join(cwd, store.PLAN_RELATIVE_PATH)),
      "successful automatic completion archives the active plan",
    );

    inputQueue.push(
      "extensions/**",
      "typecheck",
      "requested behavior works",
    );
    await commands.get("task")("Direct fix", context);
    assert(Boolean(store.loadDirectTask(cwd)), "/task writes direct-task.json");
    await runHook("before_agent_start");
    await commands.get("task-done")("", context);
    assert(!store.loadDirectTask(cwd), "/task-done clears a passing direct task");
    assert(
      appended.some(
        (entry) =>
          entry.type === "workflow-completion" &&
          entry.data.outcome === "passed",
      ),
      "passing direct task records its completion report in the session",
    );

    inputQueue.push(
      "extensions/**",
      "typecheck",
      "known failure is explicitly accepted",
    );
    await commands.get("task")("Direct override", context);
    verificationFails = true;
    inputQueue.push("Bewusster Test-Override für den Regressionstest");
    await commands.get("task-done")("", context);
    verificationFails = false;
    assert(
      !store.loadDirectTask(cwd) &&
        appended.some(
          (entry) =>
            entry.type === "workflow-completion" &&
            entry.data.outcome === "override" &&
            entry.data.overrideReason,
        ),
      "direct-task override is reasoned and recorded before cleanup",
    );

    const second = snapshotMod.finalizePlanDocument(
      quickPlan(),
      "simple_plan",
    );
    let saved = store.writePlanAndStateCAS(
      cwd,
      second.snapshot,
      "missing",
    );
    saved = store.writeWorkflowStateCAS(
      cwd,
      execution.startOrResumeExecution(saved.state),
      saved.stateToken,
    );
    await commands.get("done")("1 2", context);
    assert(
      !existsSync(path.join(cwd, store.PLAN_RELATIVE_PATH)),
      "/done uses the same completion and archive path",
    );

    const disposable = snapshotMod.finalizePlanDocument(
      quickPlan(),
      "simple_plan",
    );
    store.writePlanAndStateCAS(cwd, disposable.snapshot, "missing");
    await commands.get("discard-plan")("", context);
    assert(
      !existsSync(path.join(cwd, store.PLAN_RELATIVE_PATH)),
      "confirmed discard removes active artifacts",
    );

    mkdirSync(path.join(cwd, ".agent", "plans"), { recursive: true });
    writeFileSync(path.join(cwd, store.PLAN_RELATIVE_PATH), quickPlan());
    writeFileSync(
      path.join(cwd, store.WORKFLOW_STATE_RELATIVE_PATH),
      JSON.stringify({ version: 2, phase: "paused" }),
    );
    await commands.get("migrate-plan")("", context);
    equal(
      store.loadWorkflowStateV3(cwd).state.version,
      3,
      "interactive migration writes v3",
    );
    store.acquireWorkflowLock(cwd);
    await commands.get("recover-workflow-lock")("", context);
    await commands.get("finish")("", context);

    selectQueue.push("Berechtigungen");
    await shortcuts.get("shift+tab")(context);
    selectQueue.push(undefined);
    await shortcuts.get("super+p")(context);
    let capability;
    api.events.emit("workflow-capabilities:request", {
      respond(value) { capability = value; },
    });
    assert(Boolean(capability), "workflow capability snapshot is published");
    let thinking;
    api.events.emit("control-center:workflow-thinking-default", {
      respond(value) { thinking = value; },
    });
    assert(Boolean(thinking), "workflow thinking default is published");
    await runHook("session_shutdown");
    assert(sent.length >= 4, "workflow handoffs remain visible messages");
    assert(
      notifications.some((entry) =>
        entry.message.includes("PlanSnapshot v3 gespeichert"),
      ),
      "successful plan finalization is reported",
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
