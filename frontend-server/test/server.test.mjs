import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { isValidRequestResult } from "../../npm/packages/frontend-protocol/dist/index.js";
import {
  FrontendServer,
  assertCompatiblePiVersion,
  mapRuntimeEvent,
  normalizeCurrentSession,
  normalizeBridgeState,
  stableSessionId,
} from "../index.mjs";

test("accepts only the Pi lines supported by protocol v1", () => {
  for (const version of ["0.84.3", "0.84.99-test", "1.0.4", "1.0.10", "1.2.0", "1.2.7-test", "1.3.0", "1.3.7-test"]) {
    assert.doesNotThrow(() => assertCompatiblePiVersion(version), version);
  }
  for (const version of [
    "0.83.9",
    "0.85.0",
    "1.1.0",
    "1.4.0",
    "2.0.0",
    "1.0",
    "10.0.4",
    "",
    "garbage",
  ]) {
    assert.throws(
      () => assertCompatiblePiVersion(version),
      (error) => error.code === "PI_START_FAILED",
      version,
    );
  }
  assert.throws(
    () => assertCompatiblePiVersion(undefined),
    (error) => error.code === "PI_START_FAILED",
  );
});

test("reports the detected version without echoing arbitrary output", () => {
  assert.throws(
    () => assertCompatiblePiVersion("0.85.0"),
    (error) =>
      error.publicMessage ===
      "Installed Pi 0.85.0 is not supported by frontend protocol v1 (supported: 0.84.x, 1.0.x, 1.2.x, 1.3.x)",
  );
  assert.throws(
    () => assertCompatiblePiVersion("not a version; rm -rf /"),
    (error) =>
      error.publicMessage.startsWith("Installed Pi unknown is not supported"),
  );
});

test("maps runtime streaming and tool events to the public contract", () => {
  assert.equal(
    mapRuntimeEvent({ type: "message_update", delta: "x" }, 1).event,
    "message.delta",
  );
  assert.equal(
    mapRuntimeEvent({ type: "tool_execution_start" }, 2).event,
    "tool.started",
  );
  assert.equal(
    mapRuntimeEvent({ type: "tool_execution_end", isError: true }, 3).event,
    "tool.failed",
  );
});

test("maps bridge state without exposing a session file", () => {
  const current = {
    workflow: { mode: "work", label: "Work", available: ["work"] },
    task: { title: "Old", phaseLabel: "Ready", status: "completed" },
    activity: { kind: "idle" },
    permissions: { options: [] },
    lsp: {},
    model: { available: [] },
    thinking: { available: [] },
    changes: null,
    verification: null,
    subagents: [],
  };
  const patch = normalizeBridgeState(
    {
      workflow: { phase: "simple_plan", label: "Plan" },
      task: { title: "T", phaseLabel: "Verstehen" },
      changes: { filesCount: 1, files: ["a.ts"] },
    },
    current,
  );
  assert.equal(
    "workflow" in patch,
    false,
    "a retired workflow entry from an older session is ignored",
  );
  assert.deepEqual(patch.changes.files, [{ path: "a.ts" }]);
  assert.equal(patch.task.status, "review");
  assert.equal(JSON.stringify(patch).includes("sessionFile"), false);
});

test("replays legacy bridge snapshots together with sparse state entries", () => {
  let state = {
    workflow: undefined,
    task: { title: "Aktuelle Aufgabe", phaseLabel: "Bereit", status: "idle" },
    activity: { kind: "idle" },
    permissions: { options: [] },
    lsp: {},
    model: { available: [] },
    thinking: { available: [] },
    changes: null,
    verification: null,
    subagents: [],
  };
  const legacyFullSnapshot = {
    permissions: { level: "confirm-all", label: "Bestätigen" },
    lsp: { state: "ready", detail: "2 Server" },
    changes: { filesCount: 2, files: ["a.ts", "b.ts"] },
    verification: { status: "verified", requiredOutcomes: { verify: "success" }, blockingRecommendedIds: [] },
    task: { title: "Alte Aufgabe", phaseLabel: "Arbeiten" },
    subagents: [{ runId: "old-run", agent: "reviewer", role: "review", status: "running" }],
  };
  state = { ...state, ...normalizeBridgeState(legacyFullSnapshot, state) };
  const sparseEntry = { permissions: { level: "readonly", label: "Nur Lesen" } };
  state = { ...state, ...normalizeBridgeState(sparseEntry, state) };
  assert.equal(state.permissions.current, "readonly");
  assert.equal(state.lsp.state, "ready");
  assert.equal(state.changes.filesCount, 2);
  assert.equal(state.verification.status, "verified");
  assert.equal(state.task.title, "Alte Aufgabe");
  assert.equal(state.subagents[0].runId, "old-run");
});

test("does not confuse agent lifecycle with message lifecycle", () => {
  assert.equal(mapRuntimeEvent({ type: "agent_start" }, 1), undefined);
  assert.equal(mapRuntimeEvent({ type: "agent_settled" }, 2), undefined);
  assert.equal(
    mapRuntimeEvent(
      { type: "message_start", message: { role: "assistant", content: [] } },
      3,
    ).event,
    "message.started",
  );
});

test("classifies generic extension UI separately from notifications", () => {
  assert.equal(
    mapRuntimeEvent(
      { type: "extension_ui_request", id: "1", method: "input" },
      1,
    ).event,
    "extension-ui.requested",
  );
  assert.equal(
    mapRuntimeEvent(
      { type: "extension_ui_request", id: "2", method: "notify" },
      2,
    ).event,
    "notification",
  );
});

test("session ids can be made opaque and stable", () => {
  assert.equal(
    stableSessionId("/tmp/a.jsonl"),
    stableSessionId("/tmp/a.jsonl"),
  );
  assert.notEqual(
    stableSessionId("/tmp/a.jsonl"),
    stableSessionId("/tmp/b.jsonl"),
  );
});

test("derives streaming deltas from the 1.x assistantMessageEvent wire form", () => {
  const wire = (assistantMessageEvent) => ({
    type: "message_update",
    usage: { input: 1, output: 1 },
    assistantMessageEvent,
  });
  const text = mapRuntimeEvent(
    wire({ type: "text_delta", contentIndex: 0, delta: "Hallo" }),
    1,
  );
  assert.equal(text.event, "message.delta");
  assert.deepEqual(text.data, { delta: "Hallo" });
  assert.deepEqual(
    mapRuntimeEvent(wire({ type: "text_delta", contentIndex: 0, delta: "" }), 2)
      .data,
    { delta: "" },
  );
  assert.equal(
    mapRuntimeEvent(wire({ type: "thinking_start", contentIndex: 0 }), 3).event,
    "thinking.started",
  );
  const thinking = mapRuntimeEvent(
    wire({ type: "thinking_delta", contentIndex: 0, delta: "x" }),
    4,
  );
  assert.equal(thinking.event, "thinking.delta");
  assert.deepEqual(thinking.data, { delta: "x" });
  assert.equal(
    mapRuntimeEvent(
      wire({ type: "thinking_end", contentIndex: 0, content: "x" }),
      5,
    ).event,
    "thinking.completed",
  );
});

test("drops update shapes without a public event instead of reinterpreting them", () => {
  const wire = (assistantMessageEvent) => ({
    type: "message_update",
    assistantMessageEvent,
  });
  for (const update of [
    { type: "text_start", contentIndex: 0 },
    { type: "text_end", contentIndex: 0, content: "x" },
    { type: "toolcall_start", contentIndex: 1, id: "t1", toolName: "read" },
    { type: "toolcall_delta", contentIndex: 1, delta: "{" },
    { type: "toolcall_end", contentIndex: 1, toolCall: {} },
    { type: "text_delta", contentIndex: 0, delta: null },
    { type: "something_new" },
    undefined,
  ]) {
    assert.equal(mapRuntimeEvent(wire(update), 1), undefined);
  }
  assert.equal(mapRuntimeEvent({ type: "message_update" }, 2), undefined);
});

test("does not forward fire-and-forget extension UI methods as dialogs", () => {
  for (const method of ["setStatus", "setWidget", "setTitle", "set_editor_text"]) {
    assert.equal(
      mapRuntimeEvent({ type: "extension_ui_request", id: "1", method }, 1),
      undefined,
      method,
    );
  }
});

test("session.current liefert nur provider und id am Modell und erfüllt das Ergebnisschema", () => {
  const result = normalizeCurrentSession({
    sessionId: "s1",
    model: { provider: "openai-codex", id: "gpt-6-luna", name: "GPT-6 Luna", contextWindow: 272000, reasoning: true },
    thinkingLevel: "high",
    isStreaming: false,
    messageCount: 3,
  });
  assert.deepEqual(result.model, { provider: "openai-codex", id: "gpt-6-luna" });
  assert.equal(isValidRequestResult("session.current", result), true);
  assert.equal(isValidRequestResult("session.current", normalizeCurrentSession({ sessionId: "s2" })), true);
});

test("permission.list provides 7 entries with exactly 4 settable, levels unchanged", async () => {
  const server = new FrontendServer();
  server.runtime = { request: async () => ({}) };
  const result = await server.dispatch("permission.list", {});
  assert.deepEqual(result.levels, [
    "readonly",
    "project-write",
    "confirm-all",
    "yolo",
  ]);
  assert.equal(result.entries.length, 7);
  assert.deepEqual(
    result.entries.map((entry) => entry.level),
    [
      "readonly",
      "project-write",
      "confirm-all",
      "yolo",
      "yolo-ask",
      "yolo-full",
      "headless",
    ],
  );
  const settableEntries = result.entries.filter((entry) => entry.settable);
  assert.equal(settableEntries.length, 4);
  assert.deepEqual(
    settableEntries.map((e) => e.level),
    ["readonly", "project-write", "confirm-all", "yolo"],
  );
  assert.equal(isValidRequestResult("permission.list", result), true);
});

test("workflow is constant: list reports only work, set refuses the retired plan modes", async () => {
  const server = new FrontendServer();
  const requests = [];
  server.runtime = {
    request: async (request) => {
      requests.push(request);
      return {};
    },
  };
  const listed = await server.dispatch("workflow.list", {});
  assert.deepEqual(listed, { modes: ["work"] });
  assert.equal(isValidRequestResult("workflow.list", listed), true);
  assert.deepEqual(await server.dispatch("workflow.set", { mode: "work" }), {});
  for (const mode of ["simple_plan", "detailed_plan"]) {
    await assert.rejects(
      () => server.dispatch("workflow.set", { mode }),
      (error) => error.code === "UNSUPPORTED_CAPABILITY",
    );
  }
  assert.deepEqual(
    requests,
    [],
    "workflow.set never reaches the runtime: /workflow-set no longer exists",
  );
});

test("permission.set rejects non-settable levels with INVALID_REQUEST", async () => {
  const server = new FrontendServer();
  server.handshakeComplete = true;
  for (const level of ["yolo-full", "yolo-ask", "headless"]) {
    const outputs = [];
    server.output = {
      write(line) {
        outputs.push(JSON.parse(line));
      },
    };
    await server.handle({
      protocolVersion: 1,
      kind: "request",
      id: `perm-${level}`,
      method: "permission.set",
      params: { level },
    });
    assert.equal(outputs.length, 1);
    assert.equal(outputs[0].ok, false);
    assert.equal(outputs[0].error.code, "INVALID_REQUEST");
  }
});

test("agent_settled emits state.patch first then agent.settled event with aborted flag", () => {
  for (const [input, expectedAborted] of [
    [{ type: "agent_settled", aborted: true }, true],
    [{ type: "agent_settled" }, false],
    [{ type: "agent_settled", aborted: false }, false],
  ]) {
    const emitted = [];
    const server = new FrontendServer();
    server.sentStateSnapshot = true;
    server.output = {
      write(chunk) {
        emitted.push(JSON.parse(chunk));
      },
    };

    server.handleRuntimeEvent(input);

    assert.equal(emitted.length, 2);
    assert.equal(emitted[0].event, "state.patch");
    assert.equal(emitted[0].data.activity.kind, "idle");

    assert.equal(emitted[1].event, "agent.settled");
    assert.deepEqual(emitted[1].data, { aborted: expectedAborted });
    assert.equal(emitted[1].sequence, emitted[0].sequence + 1);
  }
});

function createMiniSession(
  dir,
  id,
  { cwd = "/workspace", name, content = "Hello" } = {},
) {
  const filePath = path.join(dir, `${id}.jsonl`);
  const lines = [
    JSON.stringify({
      type: "session",
      version: 3,
      id,
      timestamp: "2026-10-15T12:00:00.000Z",
      cwd,
    }),
    JSON.stringify({
      type: "message",
      id: `msg-${id}`,
      parentId: null,
      timestamp: "2026-10-15T12:00:01.000Z",
      message: { role: "user", content, timestamp: 1729000000000 },
    }),
  ];
  if (name) {
    lines.push(
      JSON.stringify({
        type: "session_info",
        id: `info-${id}`,
        parentId: `msg-${id}`,
        timestamp: "2026-10-15T12:00:02.000Z",
        name,
      }),
    );
  }
  writeFileSync(filePath, lines.join("\n") + "\n", "utf8");
  return filePath;
}

test("session.rename sets title in list and leaves session file bytes unchanged", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "pi-session-rename-"));
  try {
    const sessionPath = createMiniSession(tempDir, "inactive-session", {
      name: "Original Name",
      content: "First user message",
    });
    const bytesBefore = readFileSync(sessionPath);

    const server = new FrontendServer({
      env: { PI_CODING_AGENT_SESSION_DIR: tempDir },
    });
    server.runtime = {
      request: async ({ type }) => {
        if (type === "get_state") return { sessionId: "active-session" };
        return {};
      },
    };

    const res = await server.dispatch("session.rename", {
      id: "inactive-session",
      title: "  Renamed Title  ",
    });
    assert.deepEqual(res, {});

    const bytesAfter = readFileSync(sessionPath);
    assert.deepEqual(bytesBefore, bytesAfter);

    const listRes = await server.dispatch("session.list", {});
    const entry = listRes.sessions.find((s) => s.id === "inactive-session");
    assert.ok(entry);
    assert.equal(entry.name, "Renamed Title");

    await server.dispatch("session.rename", {
      id: "inactive-session",
      title: "   ",
    });
    const listResAfterClear = await server.dispatch("session.list", {});
    const entryAfterClear = listResAfterClear.sessions.find(
      (s) => s.id === "inactive-session",
    );
    assert.equal(entryAfterClear.name, "Original Name");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("session.archive sets and clears archived flag in session.list", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "pi-session-archive-"));
  try {
    createMiniSession(tempDir, "archived-session");
    const server = new FrontendServer({
      env: { PI_CODING_AGENT_SESSION_DIR: tempDir },
    });
    server.runtime = {
      request: async ({ type }) => {
        if (type === "get_state") return { sessionId: "active-session" };
        return {};
      },
    };

    const archiveOn = await server.dispatch("session.archive", {
      id: "archived-session",
      archived: true,
    });
    assert.deepEqual(archiveOn, {});

    let listRes = await server.dispatch("session.list", {});
    let entry = listRes.sessions.find((s) => s.id === "archived-session");
    assert.ok(entry);
    assert.equal(entry.archived, true);

    const archiveOff = await server.dispatch("session.archive", {
      id: "archived-session",
      archived: false,
    });
    assert.deepEqual(archiveOff, {});

    listRes = await server.dispatch("session.list", {});
    entry = listRes.sessions.find((s) => s.id === "archived-session");
    assert.ok(entry);
    assert.equal(entry.archived, undefined);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("session.delete moves file to .trash, removes from list, and second delete fails", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "pi-session-delete-"));
  try {
    const sessionPath = createMiniSession(tempDir, "delete-session");
    const server = new FrontendServer({
      env: { PI_CODING_AGENT_SESSION_DIR: tempDir },
    });
    server.runtime = {
      request: async ({ type }) => {
        if (type === "get_state") return { sessionId: "active-session" };
        return {};
      },
    };

    let listRes = await server.dispatch("session.list", {});
    assert.ok(listRes.sessions.some((s) => s.id === "delete-session"));

    const delRes = await server.dispatch("session.delete", {
      id: "delete-session",
      confirm: true,
    });
    assert.deepEqual(delRes, {});

    assert.equal(existsSync(sessionPath), false);

    const trashDir = path.join(tempDir, ".trash");
    assert.ok(existsSync(trashDir));
    const trashFiles = readdirSync(trashDir);
    assert.ok(trashFiles.some((f) => f.startsWith("delete-session.jsonl.")));

    listRes = await server.dispatch("session.list", {});
    assert.equal(
      listRes.sessions.some((s) => s.id === "delete-session"),
      false,
    );

    await assert.rejects(
      server.dispatch("session.delete", {
        id: "delete-session",
        confirm: true,
      }),
      (err) => err.code === "INVALID_REQUEST",
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("session management rejects negative cases", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "pi-session-negative-"));
  try {
    createMiniSession(tempDir, "active-session");
    createMiniSession(tempDir, "inactive-session");

    const server = new FrontendServer({
      env: { PI_CODING_AGENT_SESSION_DIR: tempDir },
    });
    server.runtime = {
      request: async ({ type }) => {
        if (type === "get_state") return { sessionId: "active-session" };
        return {};
      },
    };

    // Active session (all three)
    await assert.rejects(
      server.dispatch("session.rename", {
        id: "active-session",
        title: "New Title",
      }),
      (err) => err.code === "SESSION_BUSY",
    );
    await assert.rejects(
      server.dispatch("session.archive", {
        id: "active-session",
        archived: true,
      }),
      (err) => err.code === "SESSION_BUSY",
    );
    await assert.rejects(
      server.dispatch("session.delete", {
        id: "active-session",
        confirm: true,
      }),
      (err) => err.code === "SESSION_BUSY",
    );

    // Unknown ID
    await assert.rejects(
      server.dispatch("session.rename", {
        id: "unknown-id",
        title: "New Title",
      }),
      (err) => err.code === "INVALID_REQUEST",
    );
    await assert.rejects(
      server.dispatch("session.archive", {
        id: "unknown-id",
        archived: true,
      }),
      (err) => err.code === "INVALID_REQUEST",
    );
    await assert.rejects(
      server.dispatch("session.delete", {
        id: "unknown-id",
        confirm: true,
      }),
      (err) => err.code === "INVALID_REQUEST",
    );

    // Invalid ID: path traversal, slashes, dots, empty
    for (const badId of ["../x", "a/b", "a.b", ""]) {
      await assert.rejects(
        server.dispatch("session.rename", { id: badId, title: "Title" }),
        (err) => err.code === "INVALID_REQUEST",
      );
    }

    // Delete without confirm / confirm: false
    await assert.rejects(
      server.dispatch("session.delete", { id: "inactive-session" }),
      (err) => err.code === "INVALID_REQUEST",
    );
    await assert.rejects(
      server.dispatch("session.delete", {
        id: "inactive-session",
        confirm: false,
      }),
      (err) => err.code === "INVALID_REQUEST",
    );

    // Title with control characters
    for (const badTitle of [
      "bad\x00title",
      "bad\x1ftitle",
      "bad\x7ftitle",
      "bad\ntitle",
    ]) {
      await assert.rejects(
        server.dispatch("session.rename", {
          id: "inactive-session",
          title: badTitle,
        }),
        (err) => err.code === "INVALID_REQUEST",
      );
    }

    // Title > 120 characters
    await assert.rejects(
      server.dispatch("session.rename", {
        id: "inactive-session",
        title: "x".repeat(121),
      }),
      (err) => err.code === "INVALID_REQUEST",
    );

    // Running turn -> SESSION_BUSY
    server.state.activity = { kind: "responding" };
    await assert.rejects(
      server.dispatch("session.rename", {
        id: "inactive-session",
        title: "Title",
      }),
      (err) => err.code === "SESSION_BUSY",
    );
    await assert.rejects(
      server.dispatch("session.archive", {
        id: "inactive-session",
        archived: true,
      }),
      (err) => err.code === "SESSION_BUSY",
    );
    await assert.rejects(
      server.dispatch("session.delete", {
        id: "inactive-session",
        confirm: true,
      }),
      (err) => err.code === "SESSION_BUSY",
    );
    server.state.activity = { kind: "idle" };

    // Missing PI_CODING_AGENT_SESSION_DIR
    const noDirServer = new FrontendServer({ env: {} });
    noDirServer.runtime = server.runtime;
    for (const [method, params] of [
      ["session.rename", { id: "inactive-session", title: "New" }],
      ["session.archive", { id: "inactive-session", archived: true }],
      ["session.delete", { id: "inactive-session", confirm: true }],
    ]) {
      await assert.rejects(
        noDirServer.dispatch(method, params),
        (err) =>
          err.code === "INVALID_REQUEST" &&
          err.message ===
            "Session management requires a dedicated session directory",
      );
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("corrupt index file does not crash session.list", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "pi-session-corrupt-"));
  try {
    createMiniSession(tempDir, "regular-session", { name: "Base Name" });
    writeFileSync(
      path.join(tempDir, ".frontend-index.json"),
      "{ invalid json syntax",
      "utf8",
    );

    const server = new FrontendServer({
      env: { PI_CODING_AGENT_SESSION_DIR: tempDir },
    });
    server.runtime = { request: async () => ({}) };

    const res = await server.dispatch("session.list", {});
    assert.equal(res.sessions.length, 1);
    assert.equal(res.sessions[0].id, "regular-session");
    assert.equal(res.sessions[0].name, "Base Name");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});


for (const method of ["session.create", "session.open"]) {
  test(`${method} publishes the actual session before accepting another run`, async () => {
    const server = new FrontendServer();
    server.state.session.id = "previous-session";
    server.sessionPaths.set("next-session", "/isolated/session.jsonl");
    let currentSession = "previous-session";
    server.runtime = {
      request: async ({ type }) => {
        if (type === "new_session" || type === "switch_session") currentSession = "next-session";
        return { sessionId: currentSession, model: { provider: "test", id: "test-model" }, thinkingLevel: "low" };
      },
    };
    const emitted = [];
    server.emit = (event, data) => emitted.push({ event, data });
    const result = await server.dispatch(method, { id: "next-session" });
    assert.equal(result.id, "next-session");
    assert.equal(server.state.session.id, result.id);
    assert.equal(emitted.at(-1).event, "state.snapshot");
    assert.equal(emitted.at(-1).data.session.id, result.id);
  });
}

test("session mutations do not publish stale success when state read fails and current repairs ownership", async () => {
  for (const method of ["session.create", "session.open"]) {
    const server = new FrontendServer();
    server.state.session.id = "previous-session";
    server.sessionPaths.set("next-session", "/isolated/session.jsonl");
    let failRead = true;
    server.runtime = { request: async ({ type }) => {
      if (type === "get_state" && failRead) throw new Error("isolated state read failure");
      return { sessionId: "next-session" };
    }};
    const emitted = [];
    server.emit = (event, data) => emitted.push({ event, data });
    await assert.rejects(server.dispatch(method, { id: "next-session" }), /state read failure/);
    assert.equal(emitted.length, 0);
    failRead = false;
    const recovered = await server.dispatch("session.current", {});
    assert.equal(recovered.id, "next-session");
    assert.equal(emitted.at(-1).data.session.id, recovered.id);
  }
});
