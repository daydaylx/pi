import assert from "node:assert/strict";
import { once } from "node:events";
import net from "node:net";
import {
  mkdirSync,
  mkdtempSync,
  lstatSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PiSystemHost } from "../host.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fakePi = path.join(here, "fixtures", "fake-system-host-pi.mjs");
const FRAME_WAIT_MS = 15_000;

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
    async connect() {
      await once(socket, "connect");
    },
    send(frame) {
      socket.write(`${JSON.stringify(frame)}\n`);
    },
    next(predicate, timeoutMs = FRAME_WAIT_MS) {
      const index = frames.findIndex(predicate);
      if (index >= 0) return Promise.resolve(frames.splice(index, 1)[0]);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const index = waiters.findIndex(
            (waiter) => waiter.resolve === wrappedResolve,
          );
          if (index >= 0) waiters.splice(index, 1);
          reject(new Error("Timed out waiting for frontend host frame"));
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

async function waitForSocket(socketPath) {
  for (let attempt = 0; attempt < 750; attempt += 1) {
    try {
      const client = connectClient(socketPath);
      await client.connect();
      return client;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  throw new Error("Pi System host socket did not become available");
}

test("one Pi runtime is shared, prompts are serialized, and reconnect gets a snapshot", async () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), "pi-system-host-"));
  const agentDir = path.join(temp, "agent");
  const startLog = path.join(temp, "runtime-starts.log");
  mkdirSync(agentDir, { recursive: true, mode: 0o700 });
  writeFileSync(startLog, "");
  const host = new PiSystemHost({
    env: {
      ...process.env,
      HOME: temp,
      PI_CODING_AGENT_DIR: agentDir,
      FAKE_PI_START_LOG: startLog,
    },
    runtimeDir: temp,
    runtimePath: fakePi,
    promptStartGraceMs: 1_000,
    startupTimeoutMs: 20_000,
  });
  const clients = [];
  try {
    await host.start();
    assert.equal(
      host.profile.sessions,
      path.join(agentDir, "profile-state", "system", "host-sessions"),
    );
    const competingHost = new PiSystemHost({
      env: {
        ...process.env,
        HOME: temp,
        PI_CODING_AGENT_DIR: agentDir,
        FAKE_PI_START_LOG: startLog,
      },
      runtimeDir: temp,
      runtimePath: fakePi,
      startupTimeoutMs: 20_000,
    });
    await assert.rejects(competingHost.start(), /already listening/);
    await competingHost.stop();
    assert.equal(lstatSync(host.socketPath).isSocket(), true);

    const first = await waitForSocket(host.socketPath);
    clients.push(first);
    first.send({
      kind: "hello",
      client: { name: "desktop-test", version: "1" },
      supportedProtocolVersions: [1],
    });
    const firstHello = await first.next((frame) => frame.kind === "hello");
    assert.equal(firstHello.accepted, true);
    assert.equal(firstHello.serverVersion, "1.2.0");
    assert.ok(firstHello.capabilities.includes("shared-session-owner"));
    const firstSnapshot = await first.next(
      (frame) => frame.event === "state.snapshot",
    );
    assert.equal(firstSnapshot.data.session.id, "shared-system-session");

    const second = await waitForSocket(host.socketPath);
    clients.push(second);
    second.send({
      kind: "hello",
      client: { name: "android-test", version: "1" },
      supportedProtocolVersions: [1],
    });
    assert.equal(
      (await second.next((frame) => frame.kind === "hello")).accepted,
      true,
    );
    const secondSnapshot = await second.next(
      (frame) => frame.event === "state.snapshot",
    );
    assert.equal(secondSnapshot.data.session.id, "shared-system-session");
    second.send({
      protocolVersion: 1,
      kind: "request",
      id: "approval-forged",
      method: "ui.respond",
      params: { id: "not-pending", method: "confirm", confirmed: true },
    });
    const forgedApproval = await second.next(
      (frame) => frame.id === "approval-forged",
    );
    assert.equal(forgedApproval.ok, false);
    assert.equal(forgedApproval.error.code, "PERMISSION_DENIED");

    first.send({
      protocolVersion: 1,
      kind: "request",
      id: "prompt-first",
      method: "agent.prompt",
      params: { message: "first" },
    });
    await second.next(
      (frame) =>
        frame.event === "state.patch" &&
        frame.data.activity?.kind === "responding",
    );
    second.send({
      protocolVersion: 1,
      kind: "request",
      id: "prompt-overlap",
      method: "agent.prompt",
      params: { message: "must be rejected" },
    });
    const busy = await second.next((frame) => frame.id === "prompt-overlap");
    assert.equal(busy.ok, false);
    assert.equal(busy.error.code, "SESSION_BUSY");
    const accepted = await first.next((frame) => frame.id === "prompt-first");
    assert.equal(accepted.ok, true);
    await first.next(
      (frame) =>
        frame.event === "state.patch" && frame.data.activity?.kind === "idle",
    );

    second.socket.destroy();
    const reconnected = await waitForSocket(host.socketPath);
    clients.push(reconnected);
    reconnected.send({
      kind: "hello",
      client: { name: "android-reconnect", version: "1" },
      supportedProtocolVersions: [1],
    });
    assert.equal(
      (await reconnected.next((frame) => frame.kind === "hello")).accepted,
      true,
    );
    const replayedState = await reconnected.next(
      (frame) => frame.event === "state.snapshot",
    );
    assert.equal(replayedState.data.activity.kind, "idle");

    first.send({
      protocolVersion: 1,
      kind: "request",
      id: "racing-first",
      method: "agent.prompt",
      params: { message: "race A" },
    });
    reconnected.send({
      protocolVersion: 1,
      kind: "request",
      id: "racing-second",
      method: "agent.prompt",
      params: { message: "race B" },
    });
    const racingResponses = await Promise.all([
      first.next((frame) => frame.id === "racing-first"),
      reconnected.next((frame) => frame.id === "racing-second"),
    ]);
    assert.equal(racingResponses.filter((frame) => frame.ok).length, 1);
    assert.equal(
      racingResponses.filter((frame) => frame.error?.code === "SESSION_BUSY")
        .length,
      1,
    );
    await first.next(
      (frame) =>
        frame.event === "state.patch" && frame.data.activity?.kind === "idle",
    );

    const starts = readFileSync(startLog, "utf8").trim().split(/\r?\n/);
    assert.equal(starts.length, 1, "all clients share one Pi RPC runtime");
  } finally {
    for (const client of clients) client.socket.destroy();
    await host.stop();
    rmSync(temp, { recursive: true, force: true });
  }
});

test("uncertain prompt timeout blocks retries until session.current verifies idle", async () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), "pi-system-host-timeout-"));
  const agentDir = path.join(temp, "agent");
  const promptLog = path.join(temp, "prompts.log");
  mkdirSync(agentDir, { recursive: true, mode: 0o700 });
  writeFileSync(promptLog, "");
  const host = new PiSystemHost({
    env: {
      ...process.env,
      HOME: temp,
      PI_CODING_AGENT_DIR: agentDir,
      PI_FRONTEND_REQUEST_TIMEOUT_MS: "100",
      FAKE_PI_HANG_PROMPT: "1",
      FAKE_PI_PROMPT_LOG: promptLog,
    },
    runtimeDir: temp,
    runtimePath: fakePi,
    promptStartGraceMs: 100,
    startupTimeoutMs: 20_000,
  });
  let client;
  try {
    await host.start();
    client = await waitForSocket(host.socketPath);
    client.send({
      kind: "hello",
      client: { name: "timeout-test", version: "1" },
      supportedProtocolVersions: [1],
    });
    await client.next((frame) => frame.kind === "hello");
    await client.next((frame) => frame.event === "state.snapshot");

    const sendPrompt = (id) =>
      client.send({
        protocolVersion: 1,
        kind: "request",
        id,
        method: "agent.prompt",
        params: { message: "timeout test" },
      });
    sendPrompt("prompt-times-out");
    const timedOut = await client.next(
      (frame) => frame.id === "prompt-times-out",
    );
    assert.equal(timedOut.ok, false);
    assert.equal(timedOut.error.code, "REQUEST_TIMEOUT");

    // A stale idle patch cannot clear an uncertain timeout; only an explicit
    // session.current response is authoritative enough to permit another turn.
    host.handleBackendFrame({
      kind: "event",
      event: "state.patch",
      data: { activity: { kind: "idle" } },
    });

    sendPrompt("prompt-blocked");
    const blocked = await client.next((frame) => frame.id === "prompt-blocked");
    assert.equal(blocked.ok, false);
    assert.equal(blocked.error.code, "SESSION_BUSY");
    assert.equal(
      readFileSync(promptLog, "utf8").trim().split(/\r?\n/).length,
      1,
    );

    client.send({
      protocolVersion: 1,
      kind: "request",
      id: "inspect-session",
      method: "session.current",
      params: {},
    });
    const current = await client.next(
      (frame) => frame.id === "inspect-session",
    );
    assert.equal(current.ok, true);
    assert.equal(current.result.isStreaming, false);

    sendPrompt("prompt-after-inspection");
    const checkedPrompt = await client.next(
      (frame) => frame.id === "prompt-after-inspection",
    );
    assert.equal(checkedPrompt.ok, false);
    assert.equal(checkedPrompt.error.code, "REQUEST_TIMEOUT");
    assert.equal(
      readFileSync(promptLog, "utf8").trim().split(/\r?\n/).length,
      2,
    );
  } finally {
    client?.socket.destroy();
    await host.stop();
    rmSync(temp, { recursive: true, force: true });
  }
});

test("host refuses symlinked runtime and Pi agent directories", () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), "pi-system-host-paths-"));
  const runtimeDir = path.join(temp, "runtime");
  const agentDir = path.join(temp, "agent");
  const runtimeLink = path.join(temp, "runtime-link");
  const agentLink = path.join(temp, "agent-link");
  mkdirSync(runtimeDir, { mode: 0o700 });
  mkdirSync(agentDir, { mode: 0o700 });
  symlinkSync(runtimeDir, runtimeLink, "dir");
  symlinkSync(agentDir, agentLink, "dir");
  try {
    const env = { ...process.env, HOME: temp, PI_CODING_AGENT_DIR: agentDir };
    assert.throws(
      () => new PiSystemHost({ env, runtimeDir: runtimeLink }),
      /real directories/,
    );
    assert.throws(
      () =>
        new PiSystemHost({
          env: { ...env, PI_CODING_AGENT_DIR: agentLink },
          runtimeDir,
        }),
      /real directory/,
    );
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("discards an oversized backend frame and keeps serving requests", async () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), "pi-system-host-frames-"));
  const agentDir = path.join(temp, "agent");
  mkdirSync(agentDir, { recursive: true, mode: 0o700 });
  const host = new PiSystemHost({
    env: {
      ...process.env,
      HOME: temp,
      PI_CODING_AGENT_DIR: agentDir,
      FAKE_SYSTEM_HOST_BACKEND: "1",
      FAKE_PI_SMALL_MESSAGES: "100000",
      FAKE_PI_BIG_MESSAGES: "300000",
      FAKE_PI_OVERSIZED_MESSAGES: "400001",
    },
    runtimeDir: temp,
    frontendPath: fakePi,
    maxBackendFrameChars: 400_000,
    startupTimeoutMs: 20_000,
  });
  let client;
  try {
    await host.start();
    client = await waitForSocket(host.socketPath);
    client.send({
      kind: "hello",
      client: { name: "frame-test", version: "1" },
      supportedProtocolVersions: [1],
    });
    await client.next((frame) => frame.kind === "hello");
    const requestMessages = (id, before) =>
      client.send({
        protocolVersion: 1,
        kind: "request",
        id,
        method: "session.messages",
        params: { before },
      });
    requestMessages("messages-100k", "small");
    const hundredK = await client.next((frame) => frame.id === "messages-100k");
    assert.equal(hundredK.ok, true);
    assert.equal(hundredK.result.messages[0].blocks[0].text.length, 100_000);

    requestMessages("messages-300k", "normal");
    const threeHundredK = await client.next(
      (frame) => frame.id === "messages-300k",
    );
    assert.equal(threeHundredK.ok, true);
    assert.equal(
      threeHundredK.result.messages[0].blocks[0].text.length,
      300_000,
    );

    requestMessages("messages-too-large", "oversized");
    const tooLarge = await client.next(
      (frame) => frame.id === "messages-too-large",
    );
    assert.equal(tooLarge.ok, false);
    assert.equal(tooLarge.error.code, "RESULT_TOO_LARGE");
    assert.equal(tooLarge.error.retryable, false);
    await client.next((frame) => frame.event === "error");
    const followingFrame = await client.next(
      (frame) =>
        frame.event === "session.changed" &&
        frame.data.id === "after-oversized",
    );
    assert.equal(followingFrame.data.id, "after-oversized");
    assert.equal(host.stopping, false);

    client.send({
      protocolVersion: 1,
      kind: "request",
      id: "ping-after-oversize",
      method: "system.ping",
      params: {},
    });
    assert.equal(
      (await client.next((frame) => frame.id === "ping-after-oversize")).ok,
      true,
    );
  } finally {
    client?.socket.destroy();
    await host.stop();
    rmSync(temp, { recursive: true, force: true });
  }
});

test("host stamps epochs and resolves approval envelopes exactly once", async () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), "pi-system-host-approval-"));
  const agentDir = path.join(temp, "agent");
  const responseLog = path.join(temp, "ui-responses.log");
  mkdirSync(agentDir, { recursive: true, mode: 0o700 });
  writeFileSync(responseLog, "");
  const env = {
    ...process.env,
    HOME: temp,
    PI_CODING_AGENT_DIR: agentDir,
    FAKE_PI_UI_REQUEST: "1",
    FAKE_PI_UI_RESPONSE_LOG: responseLog,
  };
  const host = new PiSystemHost({
    env,
    runtimeDir: temp,
    runtimePath: fakePi,
    approvalTtlMs: 5_000,
    startupTimeoutMs: 20_000,
  });
  let client;
  try {
    await host.start();
    assert.equal(typeof host.hostEpoch, "string");
    client = await waitForSocket(host.socketPath);
    client.send({
      kind: "hello",
      client: { name: "approval-test", version: "1" },
      supportedProtocolVersions: [1],
    });
    const hello = await client.next((frame) => frame.kind === "hello");
    assert.equal(hello.hostEpoch, host.hostEpoch);
    assert.ok(hello.capabilities.includes("approval-envelope"));
    const request = await client.next(
      (frame) => frame.event === "extension-ui.requested",
    );
    assert.match(request.data.approval.digest, /^[a-f0-9]{64}$/);
    assert.equal(request.data.approval.sessionId, "shared-system-session");
    assert.equal(request.sessionId, "shared-system-session");

    client.send({
      protocolVersion: 1,
      kind: "request",
      id: "answer-approval",
      method: "ui.respond",
      params: { id: "fake-approval", method: "confirm", confirmed: true },
    });
    assert.equal(
      (await client.next((frame) => frame.id === "answer-approval")).ok,
      true,
    );
    assert.equal(
      (await client.next((frame) => frame.event === "extension-ui.resolved"))
        .data.outcome,
      "answered",
    );
    client.send({
      protocolVersion: 1,
      kind: "request",
      id: "answer-again",
      method: "ui.respond",
      params: { id: "fake-approval", method: "confirm", confirmed: true },
    });
    assert.equal(
      (await client.next((frame) => frame.id === "answer-again")).error.code,
      "PERMISSION_DENIED",
    );

    host.handleBackendFrame({
      kind: "event",
      event: "extension-ui.requested",
      data: { id: "expires", method: "confirm", title: "Expire me" },
    });
    const expiry = await client.next(
      (frame) =>
        frame.event === "extension-ui.requested" && frame.data.id === "expires",
    );
    assert.ok(expiry.data.approval.expiresAt);
    const resolved = await client.next(
      (frame) =>
        frame.event === "extension-ui.resolved" && frame.data.id === "expires",
      20_000,
    );
    assert.equal(resolved.data.outcome, "expired");
    const expiryResponse = readFileSync(responseLog, "utf8")
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line))
      .find((response) => response.id === "expires");
    assert.deepEqual(expiryResponse, {
      type: "extension_ui_response",
      id: "expires",
      cancelled: true,
    });
    assert.equal(host.isBusy(), false);

    host.handleBackendFrame({
      kind: "event",
      event: "extension-ui.requested",
      data: { id: "session-change", method: "confirm" },
    });
    host.handleBackendFrame({
      kind: "event",
      event: "session.changed",
      data: { id: "other-session" },
    });
    const cancelled = await client.next(
      (frame) =>
        frame.event === "extension-ui.resolved" &&
        frame.data.id === "session-change",
    );
    assert.equal(cancelled.data.outcome, "cancelled");
  } finally {
    client?.socket.destroy();
    await host.stop();
    rmSync(temp, { recursive: true, force: true });
  }
});
