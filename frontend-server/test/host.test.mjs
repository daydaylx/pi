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
import { PiSystemHost, filterBackendEnv } from "../host.mjs";
import { RunStore } from "../runs.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fakePi = path.join(here, "fixtures", "fake-system-host-pi.mjs");
const FRAME_WAIT_MS = 45_000;

test("queued run starts after the prompt reservation grace period", async () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), "pi-host-queue-grace-"));
  const agentDir = path.join(temp, "agent");
  mkdirSync(agentDir, { recursive: true, mode: 0o700 });
  const host = new PiSystemHost({
    env: { ...process.env, HOME: temp, PI_CODING_AGENT_DIR: agentDir },
    runtimeDir: temp,
    promptStartGraceMs: 10,
  });
  const queued = { pendingMessage: "queued prompt", title: "Queued title" };
  let started;
  host.runStore = { getNextQueuedRun: () => queued };
  host.isBusy = () => false;
  host.dispatchRunBackendPrompt = (run, message) => {
    started = { run, message };
  };

  try {
    host.reservePrompt("test-request");
    host.schedulePromptReservationRelease("test-request");
    await waitFor(() => started);
    assert.equal(started.run, queued);
    assert.equal(started.message, "queued prompt");
    started = undefined;
    host.stopping = true;
    host.maybeStartNextQueuedRun();
    assert.equal(
      started,
      undefined,
      "shutdown must not dispatch another queued run",
    );
  } finally {
    host.clearPromptReservation();
    rmSync(temp, { recursive: true, force: true });
  }
});

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
  for (let attempt = 0; attempt < 2_250; attempt += 1) {
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

async function waitFor(predicate, { timeout = 45_000, interval = 25 } = {}) {
  const start = Date.now();
  let lastError;
  while (Date.now() - start < timeout) {
    try {
      const result = await predicate();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  try {
    const finalResult = await predicate();
    if (finalResult) return finalResult;
  } catch (error) {
    lastError = error;
  }
  throw lastError ?? new Error("Timed out waiting for condition");
}

async function cleanupHost(host, client, tempDir) {
  if (Array.isArray(client)) {
    for (const c of client) c?.socket.destroy();
  } else {
    client?.socket.destroy();
  }
  if (host) {
    let stopFinished = false;
    host.stop().then(
      () => {
        stopFinished = true;
      },
      (err) => {
        stopFinished = err;
      },
    );
    try {
      await waitFor(() => {
        if (stopFinished instanceof Error) throw stopFinished;
        return stopFinished;
      });
    } catch {
      // stop timed out or failed
    }
    if (host.backend && host.backend.exitCode === null) {
      try {
        host.backend.kill("SIGKILL");
      } catch {
        // Process may already be dead
      }
    }
  }
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

test(
  "one Pi runtime is shared, prompts are serialized, and reconnect gets a snapshot",
  { timeout: 90_000 },
  async () => {
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
      PI_SYSTEM_HOST_ENV_PASSTHROUGH: "FAKE_PI_START_LOG",
      FAKE_PI_START_LOG: startLog,
    },
    runtimeDir: temp,
    runtimePath: fakePi,
    promptStartGraceMs: 1_000,
    startupTimeoutMs: 45_000,
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
        PI_SYSTEM_HOST_ENV_PASSTHROUGH: "FAKE_PI_START_LOG",
        FAKE_PI_START_LOG: startLog,
      },
      runtimeDir: temp,
      runtimePath: fakePi,
      startupTimeoutMs: 45_000,
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
    assert.equal(firstHello.serverVersion, "1.4.0");
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

    const starts = await waitFor(() => {
      const content = readFileSync(startLog, "utf8").trim();
      return content ? content.split(/\r?\n/).filter(Boolean) : undefined;
    });
    assert.equal(starts.length, 1, "all clients share one Pi RPC runtime");
  } finally {
    for (const client of clients) client.socket.destroy();
    await host.stop();
    rmSync(temp, { recursive: true, force: true });
  }
});

test(
  "uncertain prompt timeout blocks retries until session.current verifies idle",
  { timeout: 90_000 },
  async () => {
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
      PI_SYSTEM_HOST_ENV_PASSTHROUGH: "FAKE_PI_HANG_PROMPT,FAKE_PI_PROMPT_LOG",
      FAKE_PI_HANG_PROMPT: "1",
      FAKE_PI_PROMPT_LOG: promptLog,
    },
    runtimeDir: temp,
    runtimePath: fakePi,
    promptStartGraceMs: 100,
    startupTimeoutMs: 45_000,
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
    const promptCount1 = await waitFor(() => {
      const lines = readFileSync(promptLog, "utf8")
        .trim()
        .split(/\r?\n/)
        .filter(Boolean);
      return lines.length === 1 ? lines.length : undefined;
    });
    assert.equal(promptCount1, 1);

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
    const promptCount2 = await waitFor(() => {
      const lines = readFileSync(promptLog, "utf8")
        .trim()
        .split(/\r?\n/)
        .filter(Boolean);
      return lines.length === 2 ? lines.length : undefined;
    });
    assert.equal(promptCount2, 2);
  } finally {
    client?.socket.destroy();
    await host.stop();
    rmSync(temp, { recursive: true, force: true });
  }
});

test(
  "host refuses symlinked runtime and Pi agent directories",
  { timeout: 90_000 },
  () => {
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

test(
  "discards an oversized backend frame and keeps serving requests",
  { timeout: 90_000 },
  async () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), "pi-system-host-frames-"));
  const agentDir = path.join(temp, "agent");
  mkdirSync(agentDir, { recursive: true, mode: 0o700 });
  const host = new PiSystemHost({
    env: {
      ...process.env,
      HOME: temp,
      PI_CODING_AGENT_DIR: agentDir,
      PI_SYSTEM_HOST_ENV_PASSTHROUGH:
        "FAKE_SYSTEM_HOST_BACKEND,FAKE_PI_SMALL_MESSAGES,FAKE_PI_BIG_MESSAGES,FAKE_PI_OVERSIZED_MESSAGES",
      FAKE_SYSTEM_HOST_BACKEND: "1",
      FAKE_PI_SMALL_MESSAGES: "100000",
      FAKE_PI_BIG_MESSAGES: "300000",
      FAKE_PI_OVERSIZED_MESSAGES: "400001",
    },
    runtimeDir: temp,
    frontendPath: fakePi,
    maxBackendFrameChars: 400_000,
    startupTimeoutMs: 45_000,
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

test(
  "host stamps epochs and resolves approval envelopes exactly once",
  { timeout: 90_000 },
  async () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), "pi-system-host-approval-"));
  const agentDir = path.join(temp, "agent");
  const responseLog = path.join(temp, "ui-responses.log");
  mkdirSync(agentDir, { recursive: true, mode: 0o700 });
  writeFileSync(responseLog, "");
  const env = {
    ...process.env,
    HOME: temp,
    PI_CODING_AGENT_DIR: agentDir,
    PI_SYSTEM_HOST_ENV_PASSTHROUGH:
      "FAKE_PI_UI_REQUEST,FAKE_PI_UI_RESPONSE_LOG",
    FAKE_PI_UI_REQUEST: "1",
    FAKE_PI_UI_RESPONSE_LOG: responseLog,
  };
  const host = new PiSystemHost({
    env,
    runtimeDir: temp,
    runtimePath: fakePi,
    // Die Fake-Freigabe wird erst nach dem initialen Session-Snapshot ausgelöst.
    // So kann sie nicht abhängig von JSONL-Chunkgrenzen beim Start verschwinden.
    approvalTtlMs: 12_000,
    startupTimeoutMs: 45_000,
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
    client.send({
      protocolVersion: 1,
      kind: "request",
      id: "trigger-approval",
      method: "session.current",
      params: {},
    });
    assert.equal(
      (await client.next((frame) => frame.id === "trigger-approval")).ok,
      true,
    );
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
    );
    assert.equal(resolved.data.outcome, "expired");
    const expiryResponse = await waitFor(() => {
      const content = readFileSync(responseLog, "utf8").trim();
      if (!content) return undefined;
      const lines = content.split(/\r?\n/).filter(Boolean);
      return lines
        .map((line) => JSON.parse(line))
        .find((response) => response.id === "expires");
    });
    assert.deepEqual(expiryResponse, {
      type: "extension_ui_response",
      id: "expires",
      cancelled: true,
    });
    await waitFor(() => !host.isBusy());
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

test(
  "host rejects session management mutations with SESSION_BUSY while turn is active",
  { timeout: 90_000 },
  async () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), "pi-system-host-mutations-"));
  const agentDir = path.join(temp, "agent");
  mkdirSync(agentDir, { recursive: true, mode: 0o700 });
  const host = new PiSystemHost({
    env: {
      ...process.env,
      HOME: temp,
      PI_CODING_AGENT_DIR: agentDir,
    },
    runtimeDir: temp,
    runtimePath: fakePi,
    startupTimeoutMs: 45_000,
  });
  let client;
  try {
    await host.start();
    client = await waitForSocket(host.socketPath);
    client.send({
      kind: "hello",
      client: { name: "mutations-test", version: "1" },
      supportedProtocolVersions: [1],
    });
    await client.next((frame) => frame.kind === "hello");
    await client.next((frame) => frame.event === "state.snapshot");

    host.handleBackendFrame({
      kind: "event",
      event: "state.patch",
      data: { activity: { kind: "responding" } },
    });
    assert.equal(host.isBusy(), true);

    for (const [id, method, params] of [
      ["rename-busy", "session.rename", { id: "s1", title: "New Title" }],
      ["archive-busy", "session.archive", { id: "s1", archived: true }],
      ["delete-busy", "session.delete", { id: "s1", confirm: true }],
    ]) {
      client.send({
        protocolVersion: 1,
        kind: "request",
        id,
        method,
        params,
      });
      const response = await client.next((frame) => frame.id === id);
      assert.equal(response.ok, false);
      assert.equal(response.error.code, "SESSION_BUSY");
    }
  } finally {
    client?.socket.destroy();
    await host.stop();
    rmSync(temp, { recursive: true, force: true });
  }
});

test(
  "filterBackendEnv enforces allowlist, blocklist and validated passthrough",
  { timeout: 90_000 },
  () => {
  const input = {
    HOME: "/home/user",
    PATH: "/bin:/usr/bin",
    USER: "user",
    LOGNAME: "user",
    SHELL: "/bin/bash",
    LANG: "C.UTF-8",
    LANGUAGE: "en",
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    NO_COLOR: "1",
    FORCE_COLOR: "1",
    TZ: "UTC",
    TMPDIR: "/tmp",
    TMP: "/tmp",
    TEMP: "/tmp",
    XDG_RUNTIME_DIR: "/run/user/1000",
    XDG_CONFIG_HOME: "/home/user/.config",
    XDG_DATA_HOME: "/home/user/.local/share",
    XDG_CACHE_HOME: "/home/user/.cache",
    XDG_STATE_HOME: "/home/user/.local/state",
    XDG_SESSION_TYPE: "wayland",
    DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus",
    WAYLAND_DISPLAY: "wayland-0",
    HYPRLAND_INSTANCE_SIGNATURE: "sig123",
    HTTP_PROXY: "http://proxy:8080",
    HTTPS_PROXY: "https://proxy:8443",
    ALL_PROXY: "socks5://proxy:1080",
    NO_PROXY: "localhost",
    http_proxy: "http://proxy:8080",
    https_proxy: "https://proxy:8443",
    all_proxy: "socks5://proxy:1080",
    no_proxy: "localhost",
    SSL_CERT_FILE: "/etc/ssl/cert.pem",
    SSL_CERT_DIR: "/etc/ssl/certs",
    NODE_EXTRA_CA_CERTS: "/etc/ssl/extra.pem",
    NIX_PATH: "nixpkgs=/nix/store",
    NIX_SSL_CERT_FILE: "/etc/ssl/nix.pem",
    LOCALE_ARCHIVE: "/usr/lib/locale/locale-archive",
    // Prefixes
    LC_ALL: "C.UTF-8",
    LC_CTYPE: "C.UTF-8",
    PI_CUSTOM_VAR: "custom_pi",
    // Disallowed / sensitive
    OPENAI_API_KEY: "sk-secret123",
    ANTHROPIC_API_KEY: "sk-ant-secret",
    SSH_AUTH_SOCK: "/run/user/1000/keyring/ssh",
    GPG_AGENT_INFO: "/run/user/1000/gnupg/S.gpg-agent:0:1",
    GITHUB_TOKEN: "ghp_secret",
    // Blocklist (must never pass)
    NODE_OPTIONS: "--require evil.js",
    LD_PRELOAD: "/lib/evil.so",
    LD_LIBRARY_PATH: "/lib/evil",
    LD_AUDIT: "/lib/audit.so",
    DYLD_INSERT_LIBRARIES: "/lib/dyld.dylib",
    DYLD_LIBRARY_PATH: "/lib/dyld",
    NODE_PATH: "/evil/node_modules",
    BASH_ENV: "/evil/bashrc",
    ENV: "/evil/shrc",
    PYTHONPATH: "/evil/python",
    // Passthrough configuration
    PI_SYSTEM_HOST_ENV_PASSTHROUGH:
      "ALLOWED_CUSTOM,123INVALID,BAD-NAME,NODE_OPTIONS,ANOTHER_PASSTHROUGH",
    ALLOWED_CUSTOM: "custom-value",
    ANOTHER_PASSTHROUGH: "another-value",
  };

  const filtered = filterBackendEnv(input);

  // Exact allowed variables arrive
  assert.equal(filtered.HOME, "/home/user");
  assert.equal(filtered.PATH, "/bin:/usr/bin");
  assert.equal(filtered.USER, "user");
  assert.equal(filtered.SHELL, "/bin/bash");
  assert.equal(filtered.WAYLAND_DISPLAY, "wayland-0");
  assert.equal(filtered.SSL_CERT_FILE, "/etc/ssl/cert.pem");
  assert.equal(filtered.NIX_PATH, "nixpkgs=/nix/store");
  assert.equal(filtered.LOCALE_ARCHIVE, "/usr/lib/locale/locale-archive");

  // Prefixes arrive
  assert.equal(filtered.LC_ALL, "C.UTF-8");
  assert.equal(filtered.LC_CTYPE, "C.UTF-8");
  assert.equal(filtered.PI_CUSTOM_VAR, "custom_pi");

  // Unallowed variables do NOT arrive
  assert.equal("OPENAI_API_KEY" in filtered, false);
  assert.equal("ANTHROPIC_API_KEY" in filtered, false);
  assert.equal("SSH_AUTH_SOCK" in filtered, false);
  assert.equal("GPG_AGENT_INFO" in filtered, false);
  assert.equal("GITHUB_TOKEN" in filtered, false);

  // Blocklist variables do NOT arrive
  assert.equal("NODE_OPTIONS" in filtered, false);
  assert.equal("LD_PRELOAD" in filtered, false);
  assert.equal("LD_LIBRARY_PATH" in filtered, false);
  assert.equal("LD_AUDIT" in filtered, false);
  assert.equal("DYLD_INSERT_LIBRARIES" in filtered, false);
  assert.equal("DYLD_LIBRARY_PATH" in filtered, false);
  assert.equal("NODE_PATH" in filtered, false);
  assert.equal("BASH_ENV" in filtered, false);
  assert.equal("ENV" in filtered, false);
  assert.equal("PYTHONPATH" in filtered, false);

  // Passthrough works for normal names, but not for blocklist, and invalid names are ignored
  assert.equal(filtered.ALLOWED_CUSTOM, "custom-value");
  assert.equal(filtered.ANOTHER_PASSTHROUGH, "another-value");
  assert.equal("123INVALID" in filtered, false);
  assert.equal("BAD-NAME" in filtered, false);

  // Result is a new object and input is untouched
  assert.notEqual(filtered, input);
});

test(
  "host passes only allowed environment variables and validated passthrough to backend",
  { timeout: 90_000 },
  async () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), "pi-system-host-env-"));
  const agentDir = path.join(temp, "agent");
  const envDumpFile = path.join(temp, "backend-env.json");
  mkdirSync(agentDir, { recursive: true, mode: 0o700 });
  const host = new PiSystemHost({
    env: {
      ...process.env,
      HOME: temp,
      PI_CODING_AGENT_DIR: agentDir,
      FAKE_PI_ENV_DUMP: envDumpFile,
      FAKE_SYSTEM_HOST_BACKEND: "1",
      LANG: "de_DE.UTF-8",
      LC_MESSAGES: "de_DE.UTF-8",
      OPENAI_API_KEY: "sk-should-not-pass",
      SSH_AUTH_SOCK: "/tmp/ssh.sock",
      NODE_OPTIONS: "--require /tmp/bad.js",
      LD_PRELOAD: "/tmp/bad.so",
      PI_SYSTEM_HOST_ENV_PASSTHROUGH:
        "VALID_CUSTOM,NODE_OPTIONS,123BAD,FAKE_SYSTEM_HOST_BACKEND,FAKE_PI_ENV_DUMP",
      VALID_CUSTOM: "passed-through",
      "123BAD": "should-be-ignored",
    },
    runtimeDir: temp,
    frontendPath: fakePi,
    startupTimeoutMs: 45_000,
  });
  let client;
  try {
    await host.start();
    client = await waitForSocket(host.socketPath);
    client.send({
      kind: "hello",
      client: { name: "env-test", version: "1" },
      supportedProtocolVersions: [1],
    });
    await client.next((frame) => frame.kind === "hello");

    const dumpContent = await waitFor(() => {
      try {
        const text = readFileSync(envDumpFile, "utf8");
        return text ? JSON.parse(text) : undefined;
      } catch {
        return undefined;
      }
    });

    assert.equal(dumpContent.LANG, "de_DE.UTF-8");
    assert.equal(dumpContent.LC_MESSAGES, "de_DE.UTF-8");
    assert.equal(dumpContent.VALID_CUSTOM, "passed-through");

    assert.equal("OPENAI_API_KEY" in dumpContent, false);
    assert.equal("SSH_AUTH_SOCK" in dumpContent, false);
    assert.equal("NODE_OPTIONS" in dumpContent, false);
    assert.equal("LD_PRELOAD" in dumpContent, false);
    assert.equal("123BAD" in dumpContent, false);
  } finally {
    await cleanupHost(host, client, temp);
  }
});

test(
  "host times out slow backend requests with REQUEST_TIMEOUT, keeps serving, and ignores late response",
  { timeout: 90_000 },
  async () => {
  const temp = mkdtempSync(
    path.join(os.tmpdir(), "pi-system-host-req-timeout-"),
  );
  const agentDir = path.join(temp, "agent");
  mkdirSync(agentDir, { recursive: true, mode: 0o700 });
  const host = new PiSystemHost({
    env: {
      ...process.env,
      HOME: temp,
      PI_CODING_AGENT_DIR: agentDir,
      PI_SYSTEM_HOST_ENV_PASSTHROUGH:
        "FAKE_SYSTEM_HOST_BACKEND,FAKE_PI_HANG_PING",
      FAKE_SYSTEM_HOST_BACKEND: "1",
      FAKE_PI_HANG_PING: "1",
    },
    runtimeDir: temp,
    frontendPath: fakePi,
    requestTimeoutMs: 1_000,
    startupTimeoutMs: 45_000,
  });
  let client;
  try {
    await host.start();
    client = await waitForSocket(host.socketPath);
    client.send({
      kind: "hello",
      client: { name: "timeout-client", version: "1" },
      supportedProtocolVersions: [1],
    });
    await client.next((frame) => frame.kind === "hello");
    await client.next((frame) => frame.event === "state.snapshot");

    client.send({
      protocolVersion: 1,
      kind: "request",
      id: "slow-ping",
      method: "system.ping",
      params: {},
    });

    const timeoutResponse = await client.next(
      (frame) => frame.id === "slow-ping",
    );
    assert.equal(timeoutResponse.ok, false);
    assert.equal(timeoutResponse.error.code, "REQUEST_TIMEOUT");
    assert.equal(host.pending.size, 0);

    // Wait until backend emits its delayed response (at 1500ms)
    await new Promise((resolve) => setTimeout(resolve, 800));

    // Backend late response must not cause an unhandled error or crash
    assert.equal(host.stopping, false);

    // Host keeps serving normally
    client.send({
      protocolVersion: 1,
      kind: "request",
      id: "fast-messages",
      method: "session.messages",
      params: { before: "small" },
    });
    const fastResponse = await client.next(
      (frame) => frame.id === "fast-messages",
    );
    assert.equal(fastResponse.ok, true);
    assert.equal(host.pending.size, 0);
  } finally {
    await cleanupHost(host, client, temp);
  }
});

test(
  "stop with open dialog resolves extension-ui with cancelled outcome",
  { timeout: 90_000 },
  async () => {
  const temp = mkdtempSync(
    path.join(os.tmpdir(), "pi-system-host-dialog-stop-"),
  );
  const agentDir = path.join(temp, "agent");
  mkdirSync(agentDir, { recursive: true, mode: 0o700 });
  const host = new PiSystemHost({
    env: {
      ...process.env,
      HOME: temp,
      PI_CODING_AGENT_DIR: agentDir,
      PI_SYSTEM_HOST_ENV_PASSTHROUGH: "FAKE_SYSTEM_HOST_BACKEND",
      FAKE_SYSTEM_HOST_BACKEND: "1",
    },
    runtimeDir: temp,
    frontendPath: fakePi,
    startupTimeoutMs: 45_000,
  });
  let client;
  try {
    await host.start();
    client = await waitForSocket(host.socketPath);
    client.send({
      kind: "hello",
      client: { name: "dialog-client", version: "1" },
      supportedProtocolVersions: [1],
    });
    await client.next((frame) => frame.kind === "hello");
    await client.next((frame) => frame.event === "state.snapshot");

    host.handleBackendFrame({
      kind: "event",
      event: "extension-ui.requested",
      data: {
        id: "dialog-to-cancel",
        method: "confirm",
        title: "Pending confirm",
      },
    });
    const requested = await client.next(
      (frame) =>
        frame.event === "extension-ui.requested" &&
        frame.data.id === "dialog-to-cancel",
    );
    assert.equal(requested.data.id, "dialog-to-cancel");
    assert.equal(host.pendingUi.size, 1);

    const stopPromise = host.stop();
    const resolved = await client.next(
      (frame) =>
        frame.event === "extension-ui.resolved" &&
        frame.data.id === "dialog-to-cancel",
    );
    assert.equal(resolved.data.id, "dialog-to-cancel");
    assert.equal(resolved.data.outcome, "cancelled");
    let stopFinished = false;
    stopPromise.then(
      () => {
        stopFinished = true;
      },
      (err) => {
        stopFinished = err;
      },
    );
    await waitFor(() => {
      if (stopFinished instanceof Error) throw stopFinished;
      return stopFinished;
    });
    assert.equal(host.pendingUi.size, 0);
  } finally {
    await cleanupHost(host, client, temp);
  }
});

test("late prompt replies preserve the next reservation and unreadable ack stays uncertain", async () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), "pi-host-ack-order-"));
  mkdirSync(path.join(temp, "agent"), { mode: 0o700 });
  const host = new PiSystemHost({
    env: { HOME: temp, PI_CODING_AGENT_DIR: path.join(temp, "agent") },
    runtimeDir: temp,
  });
  host.runStore = new RunStore({
    runsDir: host.profile.runs,
    hostEpoch: "test",
  });
  host.state = { session: { id: "s" }, activity: { kind: "idle" } };
  host.backend = { stdin: { writable: true, write() {} } };
  const create = () =>
    host.runStore.createRun({ sessionId: "s", message: "test" });
  try {
    const first = create();
    host.dispatchRunBackendPrompt(first, "first");
    const oldId = host.promptReservation.requestId;
    host.handleRunLifecycleEvent("agent.settled", {});
    assert.equal(first.state, "SUCCEEDED");
    const second = create();
    host.dispatchRunBackendPrompt(second, "second");
    const newId = host.promptReservation.requestId;
    host.handleRequestTimeout(oldId);
    assert.equal(first.state, "SUCCEEDED");
    assert.equal(
      host.promptReservation.requestId,
      newId,
      "old timeout cannot release a different submit",
    );
    host.handleBackendFrameTooLarge();
    assert.equal(second.state, "UNCERTAIN");
    assert.equal(second.stateReason, "PROMPT_RESPONSE_UNREADABLE");
    assert.equal(second.result.errorCode, "RESULT_TOO_LARGE");
    assert.equal(host.promptReservation, undefined);
    assert.equal(host.pending.size, 0);
    assert.equal(
      host.isBusy(),
      true,
      "durable uncertainty replaces the transport reservation",
    );
    // Idle snapshots and late success replies cannot claim a lost prompt was safe.
    host.handleBackendFrame({
      kind: "event",
      event: "state.patch",
      data: { activity: { kind: "idle" } },
    });
    host.handleBackendFrame({
      kind: "response",
      id: newId,
      ok: true,
      result: {},
    });
    assert.equal(second.state, "UNCERTAIN");
    host.handleBackendFrame({
      kind: "event",
      event: "state.patch",
      data: { activity: { kind: "responding" } },
    });
    assert.equal(
      second.state,
      "INVESTIGATING",
      "an actual late agent start confirms dispatch",
    );
    assert.equal(second.result, null);
  } finally {
    host.clearPromptReservation();
    for (const request of host.pending.values()) clearTimeout(request.timer);
    rmSync(temp, { recursive: true, force: true });
  }
});

test("host persists tool start before announcing it to clients", () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), "pi-host-start-order-"));
  const agentDir = path.join(temp, "agent");
  mkdirSync(agentDir, { mode: 0o700 });
  const host = new PiSystemHost({
    env: { HOME: temp, PI_CODING_AGENT_DIR: agentDir },
    runtimeDir: temp,
  });
  try {
    host.state = { session: { id: "test", cwd: temp } };
    host.runStore = new RunStore({
      runsDir: path.join(temp, "runs"),
      hostEpoch: "test",
    });
    const run = host.runStore.createRun({
      sessionId: "test",
      message: "isolated crash test",
    });
    host.clients.set("test", { ready: true });
    let sawStart = false;
    host.sendClientEvent = (_client, event) => {
      if (event !== "tool.started") return;
      sawStart = true;
      const persisted = JSON.parse(
        readFileSync(path.join(temp, "runs", `${run.runId}.json`), "utf8"),
      );
      assert.equal(persisted.actions.length, 1);
      assert.equal(persisted.actions[0].toolCallId, "crash-action");
      assert.equal(persisted.actions[0].effectState, "executing");
    };
    host.handleBackendFrame({
      kind: "event",
      event: "tool.started",
      data: { toolCallId: "crash-action", toolName: "bash" },
    });
    assert.equal(sawStart, true);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
