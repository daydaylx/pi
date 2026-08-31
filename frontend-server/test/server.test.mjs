import assert from "node:assert/strict";
import test from "node:test";
import {
  assertCompatiblePiVersion,
  mapRuntimeEvent,
  normalizeBridgeState,
  stableSessionId,
} from "../index.mjs";

test("accepts only the Pi line supported by protocol v1", () => {
  assert.doesNotThrow(() => assertCompatiblePiVersion("0.84.99-test"));
  assert.throws(
    () => assertCompatiblePiVersion("0.85.0"),
    (error) => error.code === "PI_START_FAILED",
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
