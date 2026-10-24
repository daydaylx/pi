import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { RunStore } from "../runs.mjs";

test("mutations require host readback; forged proofs, failed actions and stale checks cannot succeed", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "pi-goal-check-"));
  try {
    const store = new RunStore({
      runsDir: path.join(dir, "runs"),
      hostEpoch: "test",
    });
    const create = () =>
      store.createRun({
        sessionId: "isolated",
        message: "Write the expected contents",
      });
    const mutate = (r, isError = false) => {
      store.recordToolStarted(r, {
        toolName: "write",
        toolCallId: "w",
        args: { path: path.join(dir, "result.txt") },
      });
      store.recordToolFinished(r, {
        toolName: "write",
        toolCallId: "w",
        args: { path: path.join(dir, "result.txt") },
        isError,
      });
    };
    const r = create();
    mutate(r);
    store.settleTurn(r);
    assert.equal(r.state, "VERIFYING");
    assert.throws(
      () =>
        store.recordVerification(r, {
          checkId: "fake",
          status: "passed",
          summary: "ok",
          evidenceRef: "/anything",
        }),
      /host-executed/,
    );
    const filePath = path.join(dir, "result.txt");
    writeFileSync(filePath, "expected");
    const predicate = {
      filePath,
      expectedSha256: createHash("sha256").update("expected").digest("hex"),
      checkId: "readback",
    };
    store.verifyFileReadback(r, predicate);
    assert.equal(r.state, "SUCCEEDED");
    const repeated = create();
    mutate(repeated);
    store.verifyFileReadback(repeated, {
      ...predicate,
      checkId: "first-check",
    });
    mutate(repeated);
    store.settleTurn(repeated);
    assert.equal(repeated.state, "VERIFYING");
    store.verifyFileReadback(repeated, {
      ...predicate,
      checkId: "second-check",
    });
    assert.equal(repeated.state, "SUCCEEDED");
    const failed = create();
    mutate(failed, true);
    // Even pre-existing positive evidence cannot cover a failed tool call.
    failed.verification.push({
      checkId: "old",
      status: "passed",
      proofKind: "host-file-sha256",
    });
    store.settleTurn(failed);
    assert.equal(failed.state, "FAILED");
    const mismatch = create();
    mutate(mismatch);
    store.settleTurn(mismatch);
    writeFileSync(filePath, "wrong");
    store.verifyFileReadback(mismatch, predicate);
    assert.equal(mismatch.state, "FAILED");
    const statusOnly = create();
    store.recordToolStarted(statusOnly, {
      toolName: "system_unit_status",
      toolCallId: "status",
    });
    store.recordToolFinished(statusOnly, {
      toolName: "system_unit_status",
      toolCallId: "status",
      isError: false,
    });
    store.settleTurn(statusOnly);
    assert.equal(statusOnly.state, "SUCCEEDED");
    const interrupted = create();
    store.recordToolStarted(interrupted, {
      toolName: "bash",
      toolCallId: "hang",
    });
    store.settleTurn(interrupted, { aborted: true });
    assert.equal(interrupted.state, "UNCERTAIN");
    store.reconcileRun(interrupted, {
      effectState: "applied",
      evidenceRef: "untrusted-label",
    });
    assert.equal(interrupted.state, "VERIFYING");
    const stale = create();
    stale.verification.push({
      checkId: "old",
      status: "passed",
      proofKind: "host-file-sha256",
    });
    mutate(stale);
    store.settleTurn(stale);
    assert.equal(stale.state, "VERIFYING");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("bounded events advertise gaps and always return the authoritative snapshot", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "pi-events-"));
  try {
    const store = new RunStore({ runsDir: dir, hostEpoch: "test" });
    const r = store.createRun({
      sessionId: "s",
      message: "hello",
      clientSubmissionId: "stable",
    });
    for (let i = 0; i < 205; i++)
      store.transition(r, { lastStep: `step.${i}` });
    const recovery = store.getEvents(r, 1);
    assert.equal(recovery.historyTruncated, true);
    assert.equal(recovery.events.length, 200);
    assert.equal(recovery.run.revision, r.revision);
    assert.equal(store.getEvents(r, r.revision - 2).historyTruncated, false);
    assert.equal(store.getEvents(r, r.revision + 1).historyTruncated, true);
    const restarted = new RunStore({ runsDir: dir, hostEpoch: "new" });
    restarted.loadAndReconcileStartup("new");
    assert.equal(restarted.findBySubmissionId("s", "stable").runId, r.runId);
    assert.equal(restarted.getRun(r.runId).state, "UNCERTAIN");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("trusted runtime file check traverses the real host lifecycle and cannot cover unrelated mutations", async () => {
  const { PiSystemHost } = await import("../host.mjs");
  const { mapRuntimeEvent } = await import("../index.mjs");
  const dir = mkdtempSync(path.join(os.tmpdir(), "pi-host-readback-"));
  try {
    mkdirSync(path.join(dir, "agent"), { mode: 0o700 });
    const host = new PiSystemHost({
      runtimeDir: dir,
      env: { HOME: dir, PI_CODING_AGENT_DIR: path.join(dir, "agent") },
    });
    host.hostEpoch = "test";
    host.state = { session: { id: "s", cwd: dir } };
    host.runStore = new RunStore({
      runsDir: path.join(dir, "runs"),
      hostEpoch: "test",
    });
    const r = host.runStore.createRun({
      sessionId: "s",
      message: "write expected file",
    });
    const dispatch = (message) => {
      const f = mapRuntimeEvent(message, 1);
      host.handleRunLifecycleEvent(f.event, f.data);
    };
    const filePath = path.join(dir, "goal.txt");
    dispatch({
      type: "tool_execution_start",
      toolName: "write",
      toolCallId: "write",
      args: { path: filePath },
    });
    writeFileSync(filePath, "expected");
    dispatch({
      type: "tool_execution_end",
      toolName: "write",
      toolCallId: "write",
      isError: false,
    });
    dispatch({
      type: "tool_execution_start",
      toolName: "system_file_verify",
      toolCallId: "check",
    });
    const expectedSha256 = createHash("sha256")
      .update("expected")
      .digest("hex");
    dispatch({
      type: "tool_execution_end",
      toolName: "system_file_verify",
      toolCallId: "check",
      isError: false,
      result: { details: { goalCheck: { filePath, expectedSha256 } } },
    });
    host.handleRunLifecycleEvent("agent.settled", { aborted: false });
    assert.equal(r.state, "SUCCEEDED");
    assert.equal(r.verification[0].proofKind, "host-file-sha256");
    const other = host.runStore.createRun({
      sessionId: "s",
      message: "arbitrary system operation",
    });
    host.runStore.recordToolStarted(other, {
      toolCallId: "shell",
      toolName: "bash",
    });
    host.runStore.recordToolFinished(other, {
      toolCallId: "shell",
      toolName: "bash",
      isError: false,
    });
    host.runStore.settleTurn(other);
    assert.throws(
      () =>
        host.runStore.verifyFileReadback(other, {
          filePath,
          expectedSha256,
          checkId: "unrelated",
        }),
      { code: "RUN_CONFLICT" },
    );
    assert.equal(other.state, "BLOCKED");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("opaque completed actions terminate without claiming proof; inflight and external effects stay separate", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "pi-unavailable-proof-"));
  try {
    const store = new RunStore({ runsDir: dir, hostEpoch: "test" });
    for (const toolName of [
      "audio_set_volume",
      "notify",
      "project_check",
      "desktop_focus_window",
      "bash",
    ]) {
      const r = store.createRun({
        sessionId: "s",
        message: "bounded completion",
      });
      store.recordToolStarted(r, { toolName, toolCallId: "opaque" });
      store.recordToolFinished(r, {
        toolName,
        toolCallId: "opaque",
        isError: false,
      });
      store.settleTurn(r);
      assert.equal(r.state, "BLOCKED", toolName);
      assert.equal(r.stateReason, "VERIFICATION_UNAVAILABLE");
      assert.equal(r.result.outcome, "blocked");
      assert.deepEqual(r.result.verificationRefs, []);
      assert.ok(r.remaining_issues.length);
    }
    const inflight = store.createRun({ sessionId: "s", message: "inflight" });
    store.recordToolStarted(inflight, {
      toolName: "bash",
      toolCallId: "inflight",
    });
    store.settleTurn(inflight);
    assert.equal(inflight.state, "UNCERTAIN");
    const aborted = store.createRun({ sessionId: "s", message: "abort" });
    store.settleTurn(aborted, { aborted: true });
    assert.equal(aborted.state, "CANCELLED");
    const info = store.createRun({ sessionId: "s", message: "information" });
    store.settleTurn(info);
    assert.equal(info.state, "SUCCEEDED");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("verification deadline ends missing proofs but never frees an open external effect", async () => {
  const { PiSystemHost } = await import("../host.mjs");
  const dir = mkdtempSync(path.join(os.tmpdir(), "pi-proof-deadline-"));
  try {
    mkdirSync(path.join(dir, "agent"));
    const host = new PiSystemHost({
      runtimeDir: dir,
      env: { HOME: dir, PI_CODING_AGENT_DIR: path.join(dir, "agent") },
      verificationTimeoutMs: 5,
    });
    host.runStore = new RunStore({
      runsDir: path.join(dir, "runs"),
      hostEpoch: "test",
    });
    const store = host.runStore;
    const create = () =>
      store.createRun({
        sessionId: "s",
        message: "bounded wait",
        requireVerification: true,
      });
    const finish = (r, toolName, args = {}) => {
      const toolCallId = `${toolName}-${r.actions.length}`;
      store.recordToolStarted(r, { toolCallId, toolName, args });
      store.recordToolFinished(r, { toolCallId, toolName, isError: false });
    };
    for (const tool of ["write", "user_service", "read"]) {
      const r = create();
      finish(r, tool, {
        path: path.join(dir, "goal"),
        unit: "mako.service",
        action: "start",
      });
      host.handleRunLifecycleEvent("agent.settled", { aborted: false });
      assert.equal(r.state, "VERIFYING");
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.equal(r.state, "BLOCKED", tool);
      assert.equal(r.stateReason, "VERIFICATION_UNAVAILABLE");
      assert.equal(store.getActiveOrBlockingRun(), null);
    }
    for (const withOpaque of [false, true]) {
      const r = create();
      store.recordToolStarted(r, {
        toolName: "nixos_apply",
        toolCallId: "apply",
      });
      store.recordToolFinished(r, {
        toolName: "nixos_apply",
        toolCallId: "apply",
        isError: false,
        externalJobId: "pi-job-11111111-1111-1111-1111-111111111111",
      });
      if (withOpaque) finish(r, "project_check");
      host.handleRunLifecycleEvent("agent.settled", { aborted: false });
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.equal(
        r.state,
        "UNCERTAIN",
        "open apply plus opaque work must retain reconciliation gate",
      );
      assert.equal(store.getActiveOrBlockingRun().runId, r.runId);
      assert.equal(r.actions[0].externalJobFinished, undefined);
      // Resolve only the isolated fixture gate so the next independent case can run.
      r.state = "CANCELLED";
    }
    const r = create();
    finish(r, "write", { path: path.join(dir, "goal") });
    host.handleRunLifecycleEvent("agent.settled", { aborted: false });
    writeFileSync(path.join(dir, "goal"), "proof");
    store.verifyFileReadback(r, {
      filePath: path.join(dir, "goal"),
      expectedSha256: createHash("sha256").update("proof").digest("hex"),
      checkId: "before-deadline",
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(
      r.state,
      "SUCCEEDED",
      "deadline cannot replace a completed proof",
    );
    await host.stop();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
