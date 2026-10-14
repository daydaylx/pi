import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  CAPABILITIES,
  PROTOCOL_VERSION,
  isClientHello,
  isEvent,
  isKnownEventName,
  isKnownRequestMethod,
  isRequest,
  isValidEventData,
  isValidRequestParams,
  isValidRequestResult,
  isStateSnapshotV1,
  negotiateProtocolVersion,
  protocolError,
} from "../dist/index.js";

test("negotiates the only supported wire major", () => {
  assert.equal(negotiateProtocolVersion([1]), 1);
  assert.equal(negotiateProtocolVersion([2]), undefined);
});

test("validates nested hello and rejects extra properties", () => {
  const hello = {
    kind: "hello",
    client: { name: "pi-gui", version: "0.1.0" },
    supportedProtocolVersions: [PROTOCOL_VERSION],
  };
  assert.equal(isClientHello(hello), true);
  assert.equal(isClientHello({ ...hello, unexpected: true }), false);
  assert.equal(isClientHello({ ...hello, client: { name: "pi-gui" } }), false);
});

test("accepts declared methods and events only", () => {
  assert.equal(
    isRequest({
      protocolVersion: 1,
      kind: "request",
      id: "req-1",
      method: "system.ping",
      params: {},
    }),
    true,
  );
  const unknownRequest = {
    protocolVersion: 1,
    kind: "request",
    id: "req-2",
    method: "future.method",
    params: {},
  };
  assert.equal(isRequest(unknownRequest), true);
  assert.equal(isKnownRequestMethod(unknownRequest.method), false);
  assert.equal(
    isEvent({
      protocolVersion: 1,
      kind: "event",
      sequence: 1,
      event: "state.snapshot",
      data: {},
    }),
    true,
  );
  assert.equal(isKnownEventName("future.event"), false);
});

test("validates event payloads for their declared event", () => {
  assert.equal(
    isValidEventData("notification", { message: "Ready", level: "info" }),
    true,
  );
  assert.equal(
    isValidEventData("notification", {
      message: "Ready",
      level: "info",
      path: "/private/session.jsonl",
    }),
    false,
  );
  assert.equal(isValidEventData("message.delta", {}), false);
});

test("exposes stable capabilities and structured errors", () => {
  assert.ok(CAPABILITIES.includes("sessions"));
  assert.ok(CAPABILITIES.includes("verification"));
  assert.deepEqual(
    protocolError("PI_NOT_FOUND", "Pi executable not found", "corr-1"),
    {
      code: "PI_NOT_FOUND",
      message: "Pi executable not found",
      retryable: false,
      correlationId: "corr-1",
    },
  );
  assert.equal(
    protocolError(
      "SESSION_BUSY",
      "Session already has an active turn",
      "corr-2",
    ).code,
    "SESSION_BUSY",
  );
});

test("accepts additive host capabilities and structured oversized-result errors", () => {
  assert.ok(CAPABILITIES.includes("host-epoch"));
  assert.ok(CAPABILITIES.includes("approval-envelope"));
  assert.ok(CAPABILITIES.includes("paged-messages"));
  assert.equal(
    protocolError("RESULT_TOO_LARGE", "Result too large", "corr-large")
      .retryable,
    false,
  );
});

test("validates paged message parameters and results strictly", () => {
  assert.equal(isValidRequestParams("session.messages", {}), true);
  assert.equal(
    isValidRequestParams("session.messages", { limit: 500, before: "o:25" }),
    true,
  );
  assert.equal(isValidRequestParams("session.messages", { limit: 0 }), false);
  assert.equal(
    isValidRequestParams("session.messages", { before: "x".repeat(129) }),
    false,
  );
  assert.equal(
    isValidRequestParams("session.messages", { unknown: true }),
    false,
  );
  assert.equal(
    isValidRequestResult("session.messages", {
      messages: [],
      nextCursor: "o:0",
    }),
    true,
  );
});

test("validates approval metadata and resolution outcomes", () => {
  const approval = {
    digest: "a".repeat(64),
    sessionId: "session-1",
    createdAt: "2026-10-14T10:00:00.000Z",
    expiresAt: "2026-10-14T10:02:00.000Z",
  };
  assert.equal(
    isValidEventData("extension-ui.requested", {
      id: "approval-1",
      method: "confirm",
      approval,
    }),
    true,
  );
  assert.equal(
    isValidEventData("extension-ui.requested", {
      id: "approval-1",
      method: "confirm",
      approval: { ...approval, digest: "bad" },
    }),
    false,
  );
  assert.equal(
    isValidEventData("extension-ui.resolved", {
      id: "approval-1",
      outcome: "expired",
    }),
    true,
  );
  assert.equal(
    isValidEventData("extension-ui.resolved", {
      id: "approval-1",
      outcome: "unknown",
    }),
    false,
  );
});

test("validates the complete nested state snapshot", async () => {
  const fixture = JSON.parse(
    await readFile(
      new URL("../fixtures/state-snapshot-v1.json", import.meta.url),
      "utf8",
    ),
  );
  const complete = {
    ...fixture.data,
    activity: { kind: "idle" },
    permissions: { options: [] },
    lsp: {},
    model: { available: [] },
    thinking: { available: [] },
    changes: null,
    verification: null,
    subagents: [],
    configuration: {},
  };
  assert.equal(isStateSnapshotV1(complete), true);
  assert.equal(
    isStateSnapshotV1({ ...complete, workflow: { mode: "work" } }),
    false,
  );
});

test("validates method-specific params fail-closed", () => {
  assert.equal(isValidRequestParams("session.open", { id: "session-1" }), true);
  assert.equal(isValidRequestParams("session.open", {}), false);
  assert.equal(
    isValidRequestParams("ui.respond", {
      id: "dialog-1",
      confirmed: true,
      type: "prompt",
    }),
    false,
  );
  assert.equal(
    isValidRequestParams("workflow.set", { mode: "invented" }),
    false,
  );
});

test("validates projected results and rejects internal session paths", () => {
  const stats = {
    sessionId: "session-1",
    userMessages: 1,
    assistantMessages: 1,
    toolCalls: 0,
    toolResults: 0,
    totalMessages: 2,
    tokens: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      total: 2,
    },
    cost: 0,
  };
  assert.equal(isValidRequestResult("session.stats", stats), true);
  assert.equal(
    isValidRequestResult("session.stats", {
      ...stats,
      sessionFile: "/secret/session.jsonl",
    }),
    false,
  );
});
