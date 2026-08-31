import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import readline from "node:readline";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const serverPath = path.join(root, "bin", "pi-frontend");
const fakePi = path.join(here, "fixtures", "fake-pi.mjs");

function startServer(extraEnv = {}) {
  const child = spawn(serverPath, [], {
    cwd: root,
    env: { ...process.env, PI_FRONTEND_PI_PATH: fakePi, ...extraEnv },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const lines = readline.createInterface({ input: child.stdout });
  const values = [];
  const waiters = [];
  lines.on("line", (line) => {
    const value = JSON.parse(line);
    const waiter = waiters.shift();
    if (waiter) waiter(value);
    else values.push(value);
  });
  return {
    child,
    send(value) {
      child.stdin.write(`${JSON.stringify(value)}\n`);
    },
    next() {
      if (values.length > 0) return Promise.resolve(values.shift());
      return new Promise((resolve) => waiters.push(resolve));
    },
  };
}

test("rejects incompatible protocol versions before accepting requests", async () => {
  const server = startServer();
  server.send({
    kind: "hello",
    client: { name: "test", version: "1" },
    supportedProtocolVersions: [2],
  });
  const hello = await server.next();
  assert.equal(hello.accepted, false);
  assert.equal(hello.error.code, "PROTOCOL_MISMATCH");
  server.child.kill("SIGTERM");
  await once(server.child, "exit");
});

test("reports a missing Pi executable explicitly", async () => {
  const server = startServer({
    PI_FRONTEND_PI_PATH: "/definitely/missing/pi-frontend-test",
  });
  server.send({
    kind: "hello",
    client: { name: "test", version: "1" },
    supportedProtocolVersions: [1],
  });
  const hello = await server.next();
  assert.equal(hello.accepted, false);
  assert.equal(hello.error.code, "PI_NOT_FOUND");
  assert.equal(hello.error.message, "Pi executable not found");
  server.child.kill("SIGTERM");
  await once(server.child, "exit");
});

test("rejects an incompatible installed Pi version", async () => {
  const server = startServer({ FAKE_PI_VERSION: "0.85.0" });
  server.send({
    kind: "hello",
    client: { name: "test", version: "1" },
    supportedProtocolVersions: [1],
  });
  const hello = await server.next();
  assert.equal(hello.accepted, false);
  assert.equal(hello.error.code, "PI_START_FAILED");
  assert.equal(hello.error.message, "Pi could not be started");
  server.child.kill("SIGTERM");
  await once(server.child, "exit");
});

test("negotiates v1 and serves correlated requests", async () => {
  const server = startServer();
  server.send({
    kind: "hello",
    client: { name: "test", version: "1" },
    supportedProtocolVersions: [1],
  });
  const hello = await server.next();
  assert.equal(hello.accepted, true);
  assert.equal(hello.protocolVersion, 1);
  assert.equal(hello.piVersion, "0.84.99-test");
  assert.ok(hello.capabilities.includes("sessions"));
  const snapshot = await server.next();
  assert.equal(snapshot.event, "state.snapshot");
  assert.equal(snapshot.data.session.connected, true);

  server.send({
    protocolVersion: 1,
    kind: "request",
    id: "ping-1",
    method: "system.ping",
    params: {},
  });
  const response = await server.next();
  assert.equal(response.id, "ping-1");
  assert.equal(response.ok, true);
  assert.equal(response.result.pong, true);
  server.child.kill("SIGTERM");
  await once(server.child, "exit");
});

test("rejects injected UI response fields and unknown session ids", async () => {
  const server = startServer();
  server.send({
    kind: "hello",
    client: { name: "test", version: "1" },
    supportedProtocolVersions: [1],
  });
  await server.next();
  await server.next();

  server.send({
    protocolVersion: 1,
    kind: "request",
    id: "ui-1",
    method: "ui.respond",
    params: { id: "dialog-1", confirmed: true, type: "prompt" },
  });
  const invalid = await server.next();
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, "INVALID_REQUEST");

  server.send({
    protocolVersion: 1,
    kind: "request",
    id: "messages-1",
    method: "session.messages",
    params: { id: "unknown" },
  });
  const missing = await server.next();
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, "SESSION_NOT_FOUND");
  assert.equal(missing.error.message, "Session not found");
  server.child.kill("SIGTERM");
  await once(server.child, "exit");
});

test("projects session stats without leaking session paths", async () => {
  const server = startServer();
  server.send({
    kind: "hello",
    client: { name: "test", version: "1" },
    supportedProtocolVersions: [1],
  });
  await server.next();
  await server.next();
  server.send({
    protocolVersion: 1,
    kind: "request",
    id: "stats-1",
    method: "session.stats",
    params: {},
  });
  const response = await server.next();
  assert.equal(response.ok, true);
  assert.equal(response.result.sessionId, "fake-session");
  assert.equal("sessionFile" in response.result, false);
  assert.equal(
    JSON.stringify(response).includes("/secret/session.jsonl"),
    false,
  );
  server.child.kill("SIGTERM");
  await once(server.child, "exit");
});

test("maps runtime request timeouts to REQUEST_TIMEOUT", async () => {
  const server = startServer({
    FAKE_PI_HANG_ABORT: "1",
    PI_FRONTEND_REQUEST_TIMEOUT_MS: "50",
  });
  server.send({
    kind: "hello",
    client: { name: "test", version: "1" },
    supportedProtocolVersions: [1],
  });
  await server.next();
  await server.next();
  server.send({
    protocolVersion: 1,
    kind: "request",
    id: "abort-1",
    method: "agent.abort",
    params: {},
  });
  const response = await server.next();
  assert.equal(response.ok, false);
  assert.equal(response.error.code, "REQUEST_TIMEOUT");
  server.child.kill("SIGTERM");
  await once(server.child, "exit");
});
