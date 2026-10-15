import assert from "node:assert/strict";
import test from "node:test";
import { isValidRequestResult } from "../../npm/packages/frontend-protocol/dist/index.js";
import {
  assertCompatiblePiVersion,
  mapRuntimeEvent,
  normalizeCurrentSession,
  normalizeBridgeState,
  stableSessionId,
} from "../index.mjs";

test("accepts only the Pi lines supported by protocol v1", () => {
  for (const version of ["0.84.3", "0.84.99-test", "1.0.4", "1.0.10", "1.2.0", "1.2.7-test"]) {
    assert.doesNotThrow(() => assertCompatiblePiVersion(version), version);
  }
  for (const version of [
    "0.83.9",
    "0.85.0",
    "1.1.0",
    "1.3.0",
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
      "Installed Pi 0.85.0 is not supported by frontend protocol v1 (supported: 0.84.x, 1.0.x, 1.2.x)",
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
  assert.equal(patch.workflow.mode, "simple_plan");
  assert.deepEqual(patch.changes.files, [{ path: "a.ts" }]);
  assert.equal(patch.task.status, "review");
  assert.equal(JSON.stringify(patch).includes("sessionFile"), false);
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
