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
    host.currentRunId = r.runId;
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
    host.runStore.verifyFileReadback(other, {
      filePath,
      expectedSha256,
      checkId: "unrelated",
    });
    assert.equal(other.state, "VERIFYING");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
