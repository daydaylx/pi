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

test("pins the PiSystem run wire names and rejects retired aliases", () => {
  assert.equal(
    isValidRequestParams("run.submit", {
      message: "Inspect the target",
      clientSubmissionId: "pisystem-123",
      requireVerification: true,
    }),
    true,
  );
  assert.equal(
    isValidRequestParams("run.submit", {
      message: "Inspect the target",
      clientId: "client-1",
      idempotencyKey: "key-1",
      verificationRequired: true,
    }),
    false,
  );
  assert.equal(
    isValidRequestParams("run.events", {
      runId: "run_123",
      afterRevision: 7,
    }),
    true,
  );
  assert.equal(
    isValidRequestParams("run.events", {
      runId: "run_123",
      afterRunSeq: 7,
    }),
    false,
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

test("validates agent.settled payload and rejects extra fields", () => {
  assert.equal(isKnownEventName("agent.settled"), true);
  assert.equal(isValidEventData("agent.settled", { aborted: true }), true);
  assert.equal(isValidEventData("agent.settled", { aborted: false }), true);
  assert.equal(isValidEventData("agent.settled", {}), false);
  assert.equal(isValidEventData("agent.settled", { aborted: "true" }), false);
  assert.equal(
    isValidEventData("agent.settled", { aborted: true, unexpected: true }),
    false,
  );
});

test("validates permission.list results with optional entries and backwards-compatible levels", () => {
  const legacyResult = {
    levels: ["readonly", "project-write", "confirm-all", "yolo"],
  };
  assert.equal(isValidRequestResult("permission.list", legacyResult), true);

  const fullResult = {
    levels: ["readonly", "project-write", "confirm-all", "yolo"],
    entries: [
      { level: "readonly", settable: true },
      { level: "project-write", settable: true },
      { level: "confirm-all", settable: true },
      { level: "yolo", settable: true },
      { level: "yolo-ask", settable: false },
      { level: "yolo-full", settable: false },
      { level: "headless", settable: false },
    ],
  };
  assert.equal(isValidRequestResult("permission.list", fullResult), true);

  assert.equal(
    isValidRequestResult("permission.list", {
      ...fullResult,
      entries: [{ level: "", settable: true }],
    }),
    false,
  );
  assert.equal(
    isValidRequestResult("permission.list", {
      ...fullResult,
      entries: [{ level: "readonly" }],
    }),
    false,
  );
  assert.equal(
    isValidRequestResult("permission.list", {
      ...fullResult,
      entries: [{ level: "readonly", settable: true, extra: 1 }],
    }),
    false,
  );
});

test("validates permission.set rejects non-settable levels", () => {
  for (const level of ["readonly", "project-write", "confirm-all", "yolo"]) {
    assert.equal(isValidRequestParams("permission.set", { level }), true);
  }
  for (const level of ["yolo-full", "yolo-ask", "headless", "unknown"]) {
    assert.equal(isValidRequestParams("permission.set", { level }), false);
  }
});

test("exposes session-management capability and validates request methods", () => {
  assert.ok(CAPABILITIES.includes("session-management"));
  assert.ok(isKnownRequestMethod("session.rename"));
  assert.ok(isKnownRequestMethod("session.archive"));
  assert.ok(isKnownRequestMethod("session.delete"));
});

test("validates session management parameters and results strictly", () => {
  assert.equal(
    isValidRequestParams("session.rename", { id: "session-1", title: "Title" }),
    true,
  );
  assert.equal(
    isValidRequestParams("session.rename", { id: "session_1-A", title: "" }),
    true,
  );
  assert.equal(
    isValidRequestParams("session.rename", { id: "../x", title: "Title" }),
    false,
  );
  assert.equal(
    isValidRequestParams("session.rename", { id: "a/b", title: "Title" }),
    false,
  );
  assert.equal(
    isValidRequestParams("session.rename", { id: "a.b", title: "Title" }),
    false,
  );
  assert.equal(
    isValidRequestParams("session.rename", { id: "", title: "Title" }),
    false,
  );
  assert.equal(
    isValidRequestParams("session.rename", {
      id: "a".repeat(129),
      title: "Title",
    }),
    false,
  );
  assert.equal(
    isValidRequestParams("session.rename", { id: "session-1" }),
    false,
  );
  assert.equal(
    isValidRequestParams("session.rename", { id: "session-1", title: 123 }),
    false,
  );
  assert.equal(
    isValidRequestParams("session.rename", {
      id: "session-1",
      title: "Title",
      extra: true,
    }),
    false,
  );

  assert.equal(
    isValidRequestParams("session.archive", {
      id: "session-1",
      archived: true,
    }),
    true,
  );
  assert.equal(
    isValidRequestParams("session.archive", {
      id: "session-1",
      archived: false,
    }),
    true,
  );
  assert.equal(
    isValidRequestParams("session.archive", {
      id: "session-1",
      archived: "true",
    }),
    false,
  );
  assert.equal(
    isValidRequestParams("session.archive", { id: "session-1" }),
    false,
  );
  assert.equal(
    isValidRequestParams("session.archive", {
      id: "session/1",
      archived: true,
    }),
    false,
  );
  assert.equal(
    isValidRequestParams("session.archive", {
      id: "session-1",
      archived: true,
      extra: 1,
    }),
    false,
  );

  assert.equal(
    isValidRequestParams("session.delete", { id: "session-1", confirm: true }),
    true,
  );
  assert.equal(
    isValidRequestParams("session.delete", { id: "session-1", confirm: false }),
    false,
  );
  assert.equal(
    isValidRequestParams("session.delete", { id: "session-1" }),
    false,
  );
  assert.equal(
    isValidRequestParams("session.delete", {
      id: "session-1",
      confirm: "true",
    }),
    false,
  );
  assert.equal(
    isValidRequestParams("session.delete", { id: "a/b", confirm: true }),
    false,
  );
  assert.equal(
    isValidRequestParams("session.delete", {
      id: "session-1",
      confirm: true,
      extra: true,
    }),
    false,
  );

  assert.equal(isValidRequestResult("session.rename", {}), true);
  assert.equal(isValidRequestResult("session.rename", { extra: 1 }), false);
  assert.equal(isValidRequestResult("session.archive", {}), true);
  assert.equal(isValidRequestResult("session.archive", { extra: 1 }), false);
  assert.equal(isValidRequestResult("session.delete", {}), true);
  assert.equal(isValidRequestResult("session.delete", { extra: 1 }), false);

  const baseSummary = {
    id: "session-1",
    cwd: "/workspace",
    createdAt: "2026-10-15T12:00:00.000Z",
    updatedAt: "2026-10-15T12:00:00.000Z",
    messageCount: 1,
    firstMessage: "Hello",
  };
  assert.equal(
    isValidRequestResult("session.list", {
      sessions: [baseSummary],
    }),
    true,
  );
  assert.equal(
    isValidRequestResult("session.list", {
      sessions: [{ ...baseSummary, name: "Custom Name", archived: true }],
    }),
    true,
  );
  assert.equal(
    isValidRequestResult("session.list", {
      sessions: [{ ...baseSummary, archived: false }],
    }),
    false,
  );
});

test("exposes runs capability and validates run.* methods, results and events", () => {
  assert.ok(CAPABILITIES.includes("runs"));
  for (const method of [
    "run.submit",
    "run.current",
    "run.get",
    "run.list",
    "run.cancel",
    "run.events",
    "run.reconcile",
    "run.resume",
    "run.verify",
  ]) {
    assert.ok(isKnownRequestMethod(method), method);
  }
  for (const event of [
    "run.created",
    "run.updated",
    "run.input_required",
    "run.settled",
    "run.reconcile_required",
  ]) {
    assert.ok(isKnownEventName(event), event);
  }

  assert.equal(
    isValidRequestParams("run.submit", {
      message: "Check service status",
      title: "Service Check",
      clientSubmissionId: "sub-001",
      requireVerification: true,
      queue: false,
    }),
    true,
  );
  assert.equal(isValidRequestParams("run.submit", { message: "" }), false);
  assert.equal(
    isValidRequestParams("run.submit", {
      message: "ok",
      clientSubmissionId: "bad/id",
    }),
    false,
  );
  assert.equal(isValidRequestParams("run.get", { runId: "run_123" }), true);
  assert.equal(
    isValidRequestParams("run.get", { clientSubmissionId: "sub-123" }),
    true,
  );
  assert.equal(isValidRequestParams("run.get", {}), false);

  const sampleSnapshot = {
    schemaVersion: 1,
    runId: "run_abc123",
    sessionId: "sess_1",
    clientSubmissionId: "sub-001",
    title: "Service Check",
    goal: "Check service status",
    createdAt: "2026-10-21T22:00:00.000Z",
    updatedAt: "2026-10-21T22:00:01.000Z",
    revision: 2,
    hostEpoch: "epoch-1",
    state: "EXECUTING",
    stateReason: "TOOL_EXECUTING",
    lastStep: "tool.started:bash",
    queued: false,
    requireVerification: true,
    source_of_truth: ["/etc/nixos/configuration.nix"],
    actions: [
      {
        actionId: "act_1",
        toolCallId: "tc_1",
        toolName: "bash",
        mutating: true,
        startedAt: "2026-10-21T22:00:01.000Z",
        effectState: "executing",
      },
    ],
    observations: ["read completed (tc_0)"],
    verification: [],
    rollback: {
      available: true,
      strategy: "git-or-backup-restore",
      ref: "act_1",
      status: "available",
    },
    remaining_issues: [],
    result: null,
  };

  assert.equal(
    isValidRequestResult("run.submit", {
      run: sampleSnapshot,
      deduplicated: false,
    }),
    true,
  );
  assert.equal(
    isValidRequestResult("run.current", { run: sampleSnapshot }),
    true,
  );
  assert.equal(isValidRequestResult("run.current", { run: null }), true);
  assert.equal(isValidEventData("run.created", { run: sampleSnapshot }), true);
  assert.equal(
    isValidEventData("run.input_required", {
      run: sampleSnapshot,
      uiRequestId: "ui-1",
    }),
    true,
  );
  assert.equal(
    isValidEventData("run.reconcile_required", { run: sampleSnapshot }),
    true,
  );
});
