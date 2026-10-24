import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  normalizeSystemGoal,
  readApplyJob,
  releaseApplyJob,
  readSystemGoal,
  systemGoalForTool,
} from "../state-readback.mjs";
import { RunStore } from "../runs.mjs";
import { PiSystemHost } from "../host.mjs";
import { mapRuntimeEvent } from "../index.mjs";
import { isValidEventData } from "../../npm/packages/frontend-protocol/dist/index.js";

const service = {
  kind: "user-service",
  unit: "waybar.service",
  operation: "restart",
};
const workspace = { kind: "workspace", workspace: 2 };
const systemPath = `/nix/store/${"a".repeat(32)}-nixos-system-test-26.05`;
const jobId = "pi-job-11111111-2222-3333-4444-555555555555";

test("apply job proof waits for terminal success and cleanup never stops a running or replaced unit", () => {
  const fields = (subState = "exited", result = "success") =>
    `LoadState=loaded\nActiveState=${result === "success" ? "active" : "failed"}\nSubState=${subState}\nResult=${result}\nExecMainStatus=${result === "success" ? "0" : "1"}\nInvocationID=${"a".repeat(32)}\n`;
  assert.deepEqual(readApplyJob(jobId, { exec: () => fields("running") }), {
    completed: false,
    passed: false,
    invocationId: "a".repeat(32),
  });
  assert.equal(
    readApplyJob(jobId, { exec: () => fields("failed", "exit-code") }).passed,
    false,
  );
  assert.throws(() =>
    readApplyJob("arbitrary.service", { exec: () => assert.fail() }),
  );
  for (const [output, invocation, expectedStops] of [
    [fields("running"), "a".repeat(32), 0],
    [fields("failed", "exit-code"), "a".repeat(32), 0],
    [fields(), "b".repeat(32), 0],
    [fields(), "a".repeat(32), 1],
  ]) {
    let stops = 0;
    const released = releaseApplyJob(jobId, invocation, {
      exec: (file, args) => {
        assert.equal(file, "/run/current-system/sw/bin/systemctl");
        if (args.includes("stop")) {
          stops++;
          assert.deepEqual(args, ["--user", "stop", "--", `${jobId}.service`]);
          return "";
        }
        return output;
      },
    });
    assert.equal(stops, expectedStops);
    assert.equal(released, expectedStops === 1);
  }
});

test("matching generation cannot finish an unfinished, failed or unbound apply", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "pi-apply-goal-"));
  try {
    const goal = { kind: "nixos-generation", expectedSystem: systemPath };
    let job = { completed: false, passed: false, invocationId: "a".repeat(32) };
    const store = new RunStore({
      runsDir: dir,
      hostEpoch: "test",
      stateReader: () => ({
        passed: true,
        source: "/run/current-system",
        observation: { currentSystem: systemPath },
      }),
      jobReader: (id) => {
        assert.equal(id, jobId);
        return job;
      },
    });
    const create = () => {
      const run = store.createRun({
        sessionId: "isolated",
        message: "apply exact system",
      });
      store.recordToolStarted(run, {
        toolName: "nixos_apply",
        toolCallId: "apply",
        systemTarget: goal,
      });
      store.recordToolFinished(run, {
        toolName: "nixos_apply",
        toolCallId: "apply",
        externalJobId: jobId,
        isError: false,
      });
      store.settleTurn(run);
      return run;
    };
    const run = create();
    assert.equal(run.actions[0].effectState, "executing");
    store.verifySystemReadback(run, { goal, checkId: "still-running" });
    assert.equal(run.verification.at(-1).status, "pending");
    store.settleTurn(run);
    assert.equal(run.state, "VERIFYING");
    job = { ...job, completed: true, passed: true };
    store.verifySystemReadback(run, { goal, checkId: "finished" });
    assert.equal(run.state, "SUCCEEDED");
    assert.equal(run.actions[0].jobInvocationId, job.invocationId);
    assert.equal(run.actions[0].effectState, "applied");
    const failed = create();
    job = { ...job, passed: false };
    store.verifySystemReadback(failed, { goal, checkId: "failed-job" });
    assert.equal(failed.state, "FAILED");
    const unbound = store.createRun({
      sessionId: "isolated",
      message: "unrelated task",
      requireVerification: true,
    });
    store.settleTurn(unbound);
    assert.equal(unbound.state, "BLOCKED");
    assert.throws(
      () => store.verifySystemReadback(unbound, { goal, checkId: "no-action" }),
      { code: "RUN_CONFLICT" },
    );
    assert.equal(unbound.verification.length, 0);
    const cancelled = create();
    store.settleTurn(cancelled, { aborted: true });
    assert.equal(cancelled.state, "UNCERTAIN");
    assert.equal(cancelled.actions[0].effectState, "unknown");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("job status/output reads are not mutations while stopping a job remains mutating", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "pi-job-readonly-"));
  try {
    const store = new RunStore({ runsDir: dir, hostEpoch: "test" });
    for (const action of ["status", "output", "stop", undefined]) {
      const run = store.createRun({
        sessionId: "isolated",
        message: "inspect job",
      });
      const mapped = mapRuntimeEvent(
        {
          type: "tool_execution_start",
          toolName: "system_job",
          toolCallId: "j",
          args: { action },
        },
        1,
      );
      assert.equal(isValidEventData(mapped.event, mapped.data), true);
      store.recordToolStarted(run, {
        ...mapped.data,
        args: { action: mapped.data.jobAction },
      });
      store.recordToolFinished(run, {
        toolName: "system_job",
        toolCallId: "j",
        isError: false,
      });
      assert.equal(
        run.actions[0].mutating,
        !["status", "output"].includes(action),
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("state predicates are closed and run bounded fixed commands without secrets or a shell", () => {
  let calls = 0;
  const result = readSystemGoal(service, {
    env: {
      HOME: "/test",
      SECRET: "must-not-pass",
      NODE_OPTIONS: "must-not-pass",
    },
    exec(file, args, options) {
      calls++;
      assert.equal(file, "/run/current-system/sw/bin/systemctl");
      assert.deepEqual(args, [
        "--user",
        "show",
        "--property=LoadState,ActiveState,InvocationID",
        "--",
        "waybar.service",
      ]);
      assert.equal(options.timeout, 2000);
      assert.equal(options.maxBuffer, 16384);
      assert.deepEqual(options.env, { HOME: "/test" });
      return `LoadState=loaded\nActiveState=active\nInvocationID=${"a".repeat(32)}\n`;
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.passed, true);
  for (const invalid of [
    { ...service, unit: "--bad.service" },
    { ...service, unit: "a;rm.service" },
    { ...service, shell: "true" },
    { ...workspace, workspace: 0 },
    { kind: "nixos-generation", expectedSystem: "/tmp/system" },
  ])
    assert.throws(() =>
      readSystemGoal(invalid, { exec: () => assert.fail("must not execute") }),
    );
  assert.throws(() =>
    readSystemGoal(service, {
      exec: () => "LoadState=not-found\nActiveState=inactive\n",
    }),
  );
  assert.throws(
    () =>
      readSystemGoal(service, {
        exec: () => {
          throw new Error("timeout");
        },
      }),
    /timeout/,
  );
  assert.equal(
    readSystemGoal(
      { ...service, operation: "stop" },
      { exec: () => "LoadState=loaded\nActiveState=inactive\nInvocationID=\n" },
    ).passed,
    true,
  );
});

test("workspace and running-generation checks compare independently observed values", () => {
  assert.equal(
    readSystemGoal(workspace, {
      exec: (file, args) => {
        assert.equal(file, "/run/current-system/sw/bin/hyprctl");
        assert.deepEqual(args, ["-j", "activeworkspace"]);
        return '{"id":2}';
      },
    }).passed,
    true,
  );
  assert.equal(
    readSystemGoal(workspace, { exec: () => '{"id":3}' }).passed,
    false,
  );
  assert.throws(() => readSystemGoal(workspace, { exec: () => "{}" }));
  const generation = { kind: "nixos-generation", expectedSystem: systemPath };
  assert.equal(
    readSystemGoal(generation, {
      realpath: (p) => {
        assert.equal(p, "/run/current-system");
        return systemPath;
      },
    }).passed,
    true,
  );
  assert.equal(
    readSystemGoal(generation, { realpath: () => systemPath + "-other" })
      .passed,
    false,
  );
  assert.throws(() =>
    readSystemGoal(generation, { realpath: () => "/tmp/system" }),
  );
  assert.deepEqual(
    systemGoalForTool("nixos_apply", { expectedSystem: systemPath }),
    generation,
  );
  assert.equal(systemGoalForTool("nixos_apply", {}), undefined);
  assert.equal(
    systemGoalForTool("bash", { unit: "waybar.service" }),
    undefined,
  );
});

test("system readback binds exact completed actions and requires a new invocation for restarts", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "pi-state-goal-"));
  try {
    let invocation = "a".repeat(32);
    let passed = true;
    let probes = 0;
    const store = new RunStore({
      runsDir: dir,
      hostEpoch: "test",
      stateReader: () => {
        probes++;
        return {
          passed,
          observation: { invocationId: invocation },
          source: "systemd-user:waybar.service",
        };
      },
    });
    const create = () =>
      store.createRun({ sessionId: "isolated", message: "restart service" });
    const mutate = (
      run,
      goal = service,
      isError = false,
      toolName = "user_service",
    ) => {
      store.recordToolStarted(run, {
        toolCallId: `t-${run.actions.length}`,
        toolName,
        systemTarget: goal,
      });
      store.recordToolFinished(run, {
        toolCallId: run.actions.at(-1).toolCallId,
        toolName,
        isError,
      });
      store.settleTurn(run);
    };
    const run = create();
    mutate(run);
    store.verifySystemReadback(run, {
      goal: service,
      checkId: "same-invocation",
    });
    assert.equal(run.state, "VERIFYING");
    invocation = "b".repeat(32);
    store.verifySystemReadback(run, {
      goal: service,
      checkId: "new-invocation",
    });
    assert.equal(run.state, "SUCCEEDED");
    assert.equal(probes, 3);
    const wrongTarget = create();
    mutate(wrongTarget, { ...service, operation: "start" });
    store.verifySystemReadback(wrongTarget, {
      goal: { ...service, unit: "mako.service", operation: "start" },
      checkId: "other-unit",
    });
    assert.equal(wrongTarget.state, "VERIFYING");
    const shell = create();
    mutate(shell, service, false, "bash");
    assert.throws(
      () =>
        store.verifySystemReadback(shell, {
          goal: service,
          checkId: "cannot-cover-shell",
        }),
      { code: "RUN_CONFLICT" },
    );
    assert.equal(shell.state, "BLOCKED");
    const stale = create();
    mutate(stale, workspace, false, "desktop_switch_workspace");
    store.verifySystemReadback(stale, { goal: workspace, checkId: "first" });
    assert.equal(stale.state, "SUCCEEDED");
    // Simulate another mutation in the same active turn before its settlement.
    stale.state = "EXECUTING";
    mutate(
      stale,
      { ...workspace, workspace: 3 },
      false,
      "desktop_switch_workspace",
    );
    assert.equal(stale.state, "VERIFYING");
    store.verifySystemReadback(stale, {
      goal: { ...workspace, workspace: 3 },
      checkId: "latest-workspace",
    });
    assert.equal(stale.state, "SUCCEEDED");
    const mismatch = create();
    mutate(mismatch, { ...service, operation: "start" });
    passed = false;
    store.verifySystemReadback(mismatch, {
      goal: { ...service, operation: "start" },
      checkId: "mismatch",
    });
    assert.equal(mismatch.state, "FAILED");
    const failed = create();
    mutate(failed, service, true);
    assert.equal(failed.state, "FAILED");
    assert.throws(
      () =>
        store.verifySystemReadback(failed, { goal: service, checkId: "late" }),
      /executing/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runtime mapping preserves validated goals and excludes unrelated tool results", () => {
  const start = mapRuntimeEvent(
    {
      type: "tool_execution_start",
      toolName: "user_service",
      toolCallId: "t",
      args: { unit: service.unit, action: service.operation },
    },
    1,
  );
  assert.deepEqual(start.data.systemTarget, normalizeSystemGoal(service));
  assert.equal(isValidEventData(start.event, start.data), true);
  const end = mapRuntimeEvent(
    {
      type: "tool_execution_end",
      toolName: "system_state_verify",
      toolCallId: "v",
      isError: false,
      result: { details: { stateGoalCheck: service } },
    },
    2,
  );
  assert.equal(isValidEventData(end.event, end.data), true);
  const forged = mapRuntimeEvent(
    {
      type: "tool_execution_end",
      toolName: "bash",
      toolCallId: "x",
      result: { details: { stateGoalCheck: service } },
    },
    3,
  );
  assert.equal(forged.data.stateGoalCheck, undefined);
  assert.equal(
    isValidEventData(end.event, {
      ...end.data,
      stateGoalCheck: { ...service, passed: true },
    }),
    false,
  );
});

test("the host repeats the state probe after a real mapped verification event", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "pi-state-lifecycle-"));
  try {
    let observed = 2;
    let probes = 0;
    const agentDir = path.join(dir, "agent");
    mkdirSync(agentDir, { mode: 0o700 });
    const host = new PiSystemHost({
      runtimeDir: dir,
      env: { HOME: dir, PI_CODING_AGENT_DIR: agentDir },
    });
    host.state = { session: { id: "s", cwd: dir } };
    host.runStore = new RunStore({
      runsDir: path.join(dir, "runs"),
      hostEpoch: "test",
      stateReader: () => {
        probes++;
        return {
          passed: observed === 2,
          observation: { workspace: observed },
          source: "hyprland:activeworkspace",
        };
      },
    });
    const execute = (name) => {
      const run = host.runStore.createRun({
        sessionId: "s",
        message: "switch workspace",
      });
      host.currentRunId = run.runId;
      const dispatch = (message) => {
        const frame = mapRuntimeEvent(message, 1);
        assert.equal(isValidEventData(frame.event, frame.data), true);
        host.handleRunLifecycleEvent(frame.event, frame.data);
      };
      dispatch({
        type: "tool_execution_start",
        toolName: "desktop_switch_workspace",
        toolCallId: name,
        args: { n: 2 },
      });
      dispatch({
        type: "tool_execution_end",
        toolName: "desktop_switch_workspace",
        toolCallId: name,
        isError: false,
      });
      dispatch({
        type: "tool_execution_start",
        toolName: "system_state_verify",
        toolCallId: "check",
      });
      dispatch({
        type: "tool_execution_end",
        toolName: "system_state_verify",
        toolCallId: "check",
        isError: false,
        result: { details: { stateGoalCheck: workspace } },
      });
      host.handleRunLifecycleEvent("agent.settled", { aborted: false });
      return run;
    };
    assert.equal(execute("success").state, "SUCCEEDED");
    observed = 3;
    assert.equal(execute("false-tool-claim").state, "FAILED");
    assert.equal(probes, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
