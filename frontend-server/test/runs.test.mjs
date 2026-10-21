import assert from "node:assert/strict";
import { once } from "node:events";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PiSystemHost } from "../host.mjs";
import { RunStore } from "../runs.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fakePi = path.join(here, "fixtures", "fake-system-host-pi.mjs");
const FRAME_WAIT_MS = 30_000;

function connectClient(socketPath) {
  const socket = net.createConnection(socketPath);
  const frames = [];
  const waiters = [];
  let buffer = "";
  socket.setEncoding("utf8");
  socket.on("data", (chunk) => {
    buffer += chunk;
    while (true) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) break;
      const frame = JSON.parse(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      const index = waiters.findIndex((waiter) => waiter.predicate(frame));
      if (index >= 0) waiters.splice(index, 1)[0].resolve(frame);
      else frames.push(frame);
    }
  });
  return {
    socket,
    frames,
    async connect() {
      await once(socket, "connect");
    },
    send(frame) {
      socket.write(`${JSON.stringify(frame)}\n`);
    },
    request(id, method, params = {}) {
      this.send({
        protocolVersion: 1,
        kind: "request",
        id,
        method,
        params,
      });
      return this.next(
        (frame) => frame.kind === "response" && frame.id === id,
      );
    },
    next(predicate, timeoutMs = FRAME_WAIT_MS) {
      const index = frames.findIndex(predicate);
      if (index >= 0) return Promise.resolve(frames.splice(index, 1)[0]);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const idx = waiters.findIndex((w) => w.resolve === wrappedResolve);
          if (idx >= 0) waiters.splice(idx, 1);
          reject(new Error("Timed out waiting for host frame"));
        }, timeoutMs);
        const wrappedResolve = (frame) => {
          clearTimeout(timer);
          resolve(frame);
        };
        waiters.push({ predicate, resolve: wrappedResolve });
      });
    },
  };
}

async function connectAndHello(socketPath, name = "p2-test-client") {
  const client = connectClient(socketPath);
  await client.connect();
  client.send({
    kind: "hello",
    client: { name, version: "1.0.0" },
    supportedProtocolVersions: [1],
  });
  const hello = await client.next((f) => f.kind === "hello");
  assert.equal(hello.accepted, true);
  assert.ok(hello.capabilities.includes("runs"));
  await client.next((f) => f.event === "state.snapshot");
  return { client, hello };
}

test("RunStore persists atomic manifests, isolates corrupt files, and enforces crash/reconcile rules", () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), "pi-runstore-unit-"));
  const runsDir = path.join(temp, "runs");
  try {
    const store1 = new RunStore({ runsDir, hostEpoch: "epoch-1" });
    assert.equal(statSync(runsDir).mode & 0o777, 0o700);

    // 1. Create run and verify file permissions + no raw prompt leak in public snapshot
    const run1 = store1.createRun({
      sessionId: "sess-1",
      message: " Check NetworkManager status\nsecret detail line 2",
      clientSubmissionId: "sub-100",
      requireVerification: true,
    });
    const manifestPath = path.join(runsDir, `${run1.runId}.json`);
    assert.equal(statSync(manifestPath).mode & 0o777, 0o600);
    assert.equal(run1.title, "Check NetworkManager status");
    assert.equal(run1.state, "ACCEPTED");

    // 120x idempotent lookup check -> always same runId, 0 duplicates
    for (let i = 0; i < 120; i += 1) {
      const found = store1.findBySubmissionId("sess-1", "sub-100");
      assert.equal(found?.runId, run1.runId);
    }

    // 2. Start mutating tool and simulate host crash/restart before completion
    store1.recordToolStarted(run1, { toolCallId: "tc-1", toolName: "bash" });
    assert.equal(run1.state, "EXECUTING");
    assert.equal(run1.actions[0].effectState, "executing");

    // Write a corrupt manifest file to verify isolation
    writeFileSync(path.join(runsDir, "run_corrupted1.json"), "{ invalid json", "utf8");

    // 3. New host epoch starts and reconciles disk state
    const store2 = new RunStore({ runsDir, hostEpoch: "epoch-2" });
    const reconciled = store2.loadAndReconcileStartup("epoch-2");
    assert.equal(reconciled.length, 1);
    assert.equal(reconciled[0].runId, run1.runId);
    assert.equal(reconciled[0].state, "UNCERTAIN");
    assert.equal(reconciled[0].stateReason, "HOST_RESTARTED_DURING_ACTIVE_RUN");
    assert.equal(reconciled[0].actions[0].effectState, "unknown");

    // Corrupt manifest is isolated and throws RUN_CORRUPT on direct getRun
    assert.throws(
      () => store2.getRun("run_corrupted1"),
      (err) => err.code === "RUN_CORRUPT",
    );
    const listed = store2.listRuns();
    assert.equal(listed.corrupted?.length, 1);
    assert.equal(listed.corrupted[0].runId, "run_corrupted1");

    // 4. Reconcile with "unknown" effect blocks the run and forbids replay
    const run2 = store2.createRun({
      sessionId: "sess-1",
      message: "Run 2 unknown effect",
      clientSubmissionId: "sub-200",
    });
    store2.recordToolStarted(run2, { toolCallId: "tc-2", toolName: "bash" });
    const store3 = new RunStore({ runsDir, hostEpoch: "epoch-3" });
    store3.loadAndReconcileStartup("epoch-3");
    const r2Uncertain = store3.getRun(run2.runId);
    assert.equal(r2Uncertain.state, "UNCERTAIN");
    store3.reconcileRun(r2Uncertain, {
      effectState: "unknown",
      notes: "Side effect cannot be ruled out",
    });
    assert.equal(r2Uncertain.state, "BLOCKED");
    assert.equal(r2Uncertain.result?.outcome, "blocked");

    // 5. Reconcile run1 with "not_applied" -> transitions to RESUMABLE
    const r1Uncertain = store3.getRun(run1.runId);
    store3.reconcileRun(r1Uncertain, {
      effectState: "not_applied",
      notes: "Verified target file untouched",
    });
    assert.equal(r1Uncertain.state, "RESUMABLE");
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test(
  "PiSystemHost end-to-end P2 lifecycle: multi-client, disconnect/events, queue, cancel, tool failure, verification gate, and restart recovery",
  { timeout: 120_000 },
  async () => {
    const temp = mkdtempSync(path.join(os.tmpdir(), "pi-system-host-runs-"));
    const agentDir = path.join(temp, "agent");
    const promptLog = path.join(temp, "prompts.log");
    mkdirSync(agentDir, { recursive: true, mode: 0o700 });
    writeFileSync(promptLog, "");

    const makeHost = () =>
      new PiSystemHost({
        env: {
          ...process.env,
          HOME: temp,
          PI_CODING_AGENT_DIR: agentDir,
          PI_SYSTEM_HOST_ENV_PASSTHROUGH: "FAKE_PI_PROMPT_LOG",
          FAKE_PI_PROMPT_LOG: promptLog,
        },
        runtimeDir: temp,
        runtimePath: fakePi,
        promptStartGraceMs: 500,
        startupTimeoutMs: 45_000,
      });

    let host = makeHost();
    const clients = [];
    try {
      await host.start();
      const { client: c1, hello: h1 } = await connectAndHello(
        host.socketPath,
        "client-1",
      );
      const { client: c2 } = await connectAndHello(host.socketPath, "client-2");
      clients.push(c1, c2);

      // 1. Submit run from client 1 with clientSubmissionId & requireVerification: true
      const submitRes = await c1.request("sub-1", "run.submit", {
        message: "Configure test unit [TOOL_OK]",
        title: "Configure test unit",
        clientSubmissionId: "idem-key-1",
        requireVerification: true,
      });
      assert.equal(submitRes.ok, true);
      assert.equal(submitRes.result.deduplicated, false);
      const runId1 = submitRes.result.run.runId;

      // Client 2 observes run.created for the same runId
      const createdOnC2 = await c2.next(
        (f) => f.event === "run.created" && f.data.run.runId === runId1,
      );
      assert.equal(createdOnC2.data.run.title, "Configure test unit");

      // Idempotent duplicate submission with same clientSubmissionId returns same runId, deduplicated: true
      const dupRes = await c2.request("sub-1-dup", "run.submit", {
        message: "Configure test unit [TOOL_OK]",
        clientSubmissionId: "idem-key-1",
      });
      assert.equal(dupRes.ok, true);
      assert.equal(dupRes.result.deduplicated, true);
      assert.equal(dupRes.result.run.runId, runId1);

      // Concurrent submission without queue: true is rejected with RUN_BUSY
      const busyRes = await c2.request("sub-busy", "run.submit", {
        message: "Concurrent unqueued task",
        clientSubmissionId: "idem-key-busy",
      });
      assert.equal(busyRes.ok, false);
      assert.equal(busyRes.error.code, "RUN_BUSY");

      // Concurrent submission WITH queue: true is accepted into the serialized queue
      const queuedRes = await c2.request("sub-queued", "run.submit", {
        message: "Second queued task",
        title: "Queued task 2",
        clientSubmissionId: "idem-key-2",
        queue: true,
      });
      assert.equal(queuedRes.ok, true);
      assert.equal(queuedRes.result.run.state, "ACCEPTED");
      assert.equal(queuedRes.result.run.queued, true);
      const runId2 = queuedRes.result.run.runId;

      // Disconnect client 2 while run 1 is executing
      c2.socket.destroy();

      // Wait for run 1 turn to settle: because requireVerification: true, it must stop in VERIFYING (not SUCCEEDED!)
      await c1.next(
        (f) =>
          f.event === "run.updated" &&
          f.data.run.runId === runId1 &&
          f.data.run.state === "VERIFYING",
      );

      const getVerifying = await c1.request("get-1", "run.get", {
        runId: runId1,
      });
      assert.equal(getVerifying.ok, true);
      assert.equal(getVerifying.result.run.state, "VERIFYING");
      assert.equal(getVerifying.result.run.actions.length, 1);
      assert.equal(getVerifying.result.run.actions[0].effectState, "applied");

      // Reconnect client 2 and fetch missed run events via run.events
      const { client: c2Reconnected } = await connectAndHello(
        host.socketPath,
        "client-2-reconnected",
      );
      clients.push(c2Reconnected);
      const eventsRes = await c2Reconnected.request("ev-1", "run.events", {
        runId: runId1,
        afterRevision: 1,
      });
      assert.equal(eventsRes.ok, true);
      assert.ok(eventsRes.result.events.length >= 2);
      assert.equal(eventsRes.result.run.state, "VERIFYING");

      // Record verification pass -> Run 1 transitions to SUCCEEDED and automatically starts queued Run 2!
      const verifyRes = await c1.request("ver-1", "run.verify", {
        runId: runId1,
        checkId: "unit-active-check",
        status: "passed",
        summary: "Unit verified active",
        evidenceRef: "systemctl-check-1",
      });
      assert.equal(verifyRes.ok, true);
      assert.equal(verifyRes.result.run.state, "SUCCEEDED");

      // Queued Run 2 now automatically runs and settles as SUCCEEDED
      const run2Settled = await c1.next(
        (f) => f.event === "run.settled" && f.data.run.runId === runId2,
      );
      assert.equal(run2Settled.data.run.state, "SUCCEEDED");

      // 2. Test tool failure -> Run must end in FAILED, never SUCCEEDED
      const failSubmit = await c1.request("sub-fail", "run.submit", {
        message: "Run failing command [TOOL_FAIL]",
        title: "Failing command test",
      });
      assert.equal(failSubmit.ok, true);
      const failRunId = failSubmit.result.run.runId;
      const failSettled = await c1.next(
        (f) => f.event === "run.settled" && f.data.run.runId === failRunId,
      );
      assert.equal(failSettled.data.run.state, "FAILED");
      assert.equal(failSettled.data.run.result.outcome, "failed");

      // 3. Test controlled cancel of normal active run -> CANCELLED
      const cancelSubmit = await c1.request("sub-cancel", "run.submit", {
        message: "Long normal turn",
        title: "Cancelable task",
      });
      assert.equal(cancelSubmit.ok, true);
      const cancelRunId = cancelSubmit.result.run.runId;
      const cancelRes = await c1.request("do-cancel", "run.cancel", {
        runId: cancelRunId,
        reason: "User requested stop",
      });
      assert.equal(cancelRes.ok, true);
      assert.equal(cancelRes.result.cancelScope, "turn_abort_requested");
      const cancelSettled = await c1.next(
        (f) => f.event === "run.settled" && f.data.run.runId === cancelRunId,
      );
      assert.equal(cancelSettled.data.run.state, "CANCELLED");
      assert.equal(
        cancelSettled.data.run.result.cancelScope,
        "turn_and_tools_stopped",
      );

      // 4. Test host crash/restart while a mutating tool is in-flight ([TOOL_HANG])
      const hangSubmit = await c1.request("sub-hang", "run.submit", {
        message: "Mutate system state [TOOL_HANG]",
        title: "Interrupted system mutation",
      });
      assert.equal(hangSubmit.ok, true);
      const hangRunId = hangSubmit.result.run.runId;
      await c1.next(
        (f) =>
          f.event === "run.updated" &&
          f.data.run.runId === hangRunId &&
          f.data.run.state === "EXECUTING",
      );

      // Stop host mid-tool and restart a new PiSystemHost on the same profile directory
      for (const c of clients) c.socket.destroy();
      clients.length = 0;
      await host.stop();

      const promptLinesBeforeRestart = readFileSync(promptLog, "utf8")
        .trim()
        .split(/\r?\n/)
        .filter(Boolean).length;

      host = makeHost();
      await host.start();
      const { client: cAfter, hello: hAfter } = await connectAndHello(
        host.socketPath,
        "client-after-restart",
      );
      clients.push(cAfter);
      assert.notEqual(hAfter.hostEpoch, h1.hostEpoch);

      // Verify no prompt was auto-replayed on restart!
      const promptLinesAfterRestart = readFileSync(promptLog, "utf8")
        .trim()
        .split(/\r?\n/)
        .filter(Boolean).length;
      assert.equal(promptLinesAfterRestart, promptLinesBeforeRestart);

      // Client immediately receives run.reconcile_required and run.current shows UNCERTAIN
      const currentAfterRestart = await cAfter.request(
        "cur-after",
        "run.current",
      );
      assert.equal(currentAfterRestart.ok, true);
      assert.equal(currentAfterRestart.result.run.runId, hangRunId);
      assert.equal(currentAfterRestart.result.run.state, "UNCERTAIN");
      assert.equal(
        currentAfterRestart.result.run.stateReason,
        "HOST_RESTARTED_DURING_ACTIVE_RUN",
      );

      // Direct run.resume without reconcile MUST be rejected with RUN_CONFLICT
      const prematureResume = await cAfter.request("res-blocked", "run.resume", {
        runId: hangRunId,
      });
      assert.equal(prematureResume.ok, false);
      assert.equal(prematureResume.error.code, "RUN_CONFLICT");

      // Reconcile as "not_applied" -> transitions to RESUMABLE, then resume with safe message -> SUCCEEDED
      const recRes = await cAfter.request("rec-1", "run.reconcile", {
        runId: hangRunId,
        effectState: "not_applied",
        notes: "Checked target state: command did not take effect before crash",
      });
      assert.equal(recRes.ok, true);
      assert.equal(recRes.result.run.state, "RESUMABLE");

      const resumeRes = await cAfter.request("res-ok", "run.resume", {
        runId: hangRunId,
        message: "Safe resumed execution [TOOL_OK]",
      });
      assert.equal(resumeRes.ok, true);
      const resumedSettled = await cAfter.next(
        (f) => f.event === "run.settled" && f.data.run.runId === hangRunId,
      );
      assert.equal(resumedSettled.data.run.state, "SUCCEEDED");

      // 5. Verify existing v1 methods still work seamlessly
      const pingRes = await cAfter.request("v1-ping", "system.ping");
      assert.equal(pingRes.ok, true);
      assert.equal(pingRes.result.pong, true);

      // 6. Test 100+ concurrent/retry run.submit requests with same clientSubmissionId -> 0 duplicates
      const promptLinesBefore100 = readFileSync(promptLog, "utf8")
        .trim()
        .split(/\r?\n/)
        .filter(Boolean).length;
      const burstPromises = [];
      for (let i = 0; i < 105; i += 1) {
        burstPromises.push(
          cAfter.request(`burst-${i}`, "run.submit", {
            message: "Idempotent burst task [TOOL_OK]",
            title: "Burst task",
            clientSubmissionId: "burst-sub-105",
          }),
        );
      }
      const burstResults = await Promise.all(burstPromises);
      const uniqueRunIds = new Set(burstResults.map((r) => r.result.run.runId));
      assert.equal(uniqueRunIds.size, 1, "exactly one run created across 105 submissions");
      assert.equal(
        burstResults.filter((r) => r.result.deduplicated === false).length,
        1,
      );
      assert.equal(
        burstResults.filter((r) => r.result.deduplicated === true).length,
        104,
      );
      const burstRunId = [...uniqueRunIds][0];

      // Queue a run while burstRun is active and cancel the queued run before it starts
      const qCancelSub = await cAfter.request("q-cancel-sub", "run.submit", {
        message: "Queued to be cancelled",
        queue: true,
      });
      assert.equal(qCancelSub.ok, true);
      const qCancelId = qCancelSub.result.run.runId;
      const qCancelRes = await cAfter.request("q-cancel-do", "run.cancel", {
        runId: qCancelId,
      });
      assert.equal(qCancelRes.ok, true);
      assert.equal(qCancelRes.result.cancelScope, "queued_removed");
      assert.equal(qCancelRes.result.run.state, "CANCELLED");

      await cAfter.next(
        (f) => f.event === "run.settled" && f.data.run.runId === burstRunId,
      );
      const promptLinesAfter100 = readFileSync(promptLog, "utf8")
        .trim()
        .split(/\r?\n/)
        .filter(Boolean).length;
      assert.equal(
        promptLinesAfter100 - promptLinesBefore100,
        1,
        "backend prompt executed only once for 105 retries and cancelled queued run never executed",
      );

      // 7. Test cancel while mutating tool is still in-flight ([TOOL_HANG]) -> UNCERTAIN (never false CANCELLED)
      const hangCancelSub = await cAfter.request("hc-sub", "run.submit", {
        message: "In-flight tool cancel [TOOL_HANG]",
        title: "In-flight tool cancel",
      });
      assert.equal(hangCancelSub.ok, true);
      const hcRunId = hangCancelSub.result.run.runId;
      await cAfter.next(
        (f) =>
          f.event === "run.updated" &&
          f.data.run.runId === hcRunId &&
          f.data.run.state === "EXECUTING",
      );
      const hcCancelRes = await cAfter.request("hc-cancel", "run.cancel", {
        runId: hcRunId,
      });
      assert.equal(hcCancelRes.ok, true);
      assert.equal(hcCancelRes.result.run.state, "CANCELLING");
      const hcReconcileReq = await cAfter.next(
        (f) =>
          f.event === "run.reconcile_required" &&
          f.data.run.runId === hcRunId,
      );
      assert.equal(hcReconcileReq.data.run.state, "UNCERTAIN");
      assert.equal(
        hcReconcileReq.data.run.result.cancelScope,
        "turn_aborted_external_effect_uncertain",
      );

      // Reconcile as already applied with evidence -> SUCCEEDED without re-running prompt
      const hcRec = await cAfter.request("hc-rec", "run.reconcile", {
        runId: hcRunId,
        effectState: "applied",
        notes: "External tool completed before abort took effect",
        evidenceRef: "state-check-ok",
      });
      assert.equal(hcRec.ok, true);
      assert.equal(hcRec.result.run.state, "SUCCEEDED");
    } finally {
      for (const c of clients) c.socket.destroy();
      await host.stop();
      rmSync(temp, { recursive: true, force: true });
    }
  },
);
