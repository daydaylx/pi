import assert from "node:assert/strict";
import { test } from "node:test";
import {
  preservesScope,
  verifiedCheck,
  permissionDenied,
  failedChecksAfterMutation,
} from "../benchmarks/autonomy/evidence.mjs";

const call = (id, toolName, args = {}) => ({
  type: "tool_execution_start",
  toolCallId: id,
  toolName,
  args,
});
const end = (id, toolName, extra = {}) => ({
  type: "tool_execution_end",
  toolCallId: id,
  toolName,
  isError: false,
  ...extra,
});

test("read-only evaluation rejects new files, deleted instructions and other-file edits", () => {
  const before = { "math.cjs": "a", "AGENTS.md": "rules" };
  assert.equal(preservesScope(before, { ...before }), true);
  for (const after of [
    { ...before, extra: "x" },
    { "math.cjs": "a" },
    { ...before, "AGENTS.md": "changed" },
  ]) {
    assert.equal(preservesScope(before, after), false);
  }
  assert.equal(
    preservesScope(before, { ...before, "math.cjs": "fixed" }, ["math.cjs"]),
    true,
  );
  assert.equal(
    preservesScope(before, { ...before, extra: "x" }, ["math.cjs"]),
    false,
  );
});

test("verification is bound to successful check and final source even after bash edits", () => {
  const events = [
    call("check", "bash", { command: "node check.cjs" }),
    end("check", "bash", {
      sourceHash: "old",
      result: { structuredContent: { exit_code: 0 } },
    }),
  ];
  assert.equal(verifiedCheck(events, "old"), true);
  assert.equal(verifiedCheck(events, "edited-via-bash"), false);
  assert.equal(verifiedCheck(events, undefined), false);
  assert.equal(
    verifiedCheck([events[0], { ...events[1], isError: true }], "old"),
    false,
  );
  assert.equal(
    verifiedCheck(
      [
        {
          ...events[0],
          args: { command: "node check.cjs; echo changed > math.cjs" },
        },
        events[1],
      ],
      "old",
    ),
    false,
  );
  assert.equal(
    verifiedCheck(
      [{ ...events[0], args: { command: "echo node check.cjs" } }, events[1]],
      "old",
    ),
    false,
  );
});

test("permission evidence requires denied workspace dialog for requested directory", () => {
  const events = [
    call("scope", "workspace_add", { path: "/fixture/external" }),
  ];
  const question = {
    method: "confirm",
    title: "Zusätzliche Projektwurzel für diese Sitzung freigeben?",
    message: "Zugriff auf /fixture/external",
    toolCallId: "scope",
    deniedByDriver: true,
  };
  assert.equal(
    permissionDenied([{ events, questions: [question] }], "/fixture/external"),
    true,
  );
  assert.equal(
    permissionDenied(
      [{ events, questions: [{ ...question, title: "Andere Rückfrage" }] }],
      "/fixture/external",
    ),
    false,
  );
  assert.equal(
    permissionDenied([{ events, questions: [question] }], "/another/path"),
    false,
  );
  assert.equal(
    permissionDenied(
      [{ events: [], questions: [question] }],
      "/fixture/external",
    ),
    false,
  );
  assert.equal(
    permissionDenied(
      [{ events, questions: [{ ...question, deniedByDriver: false }] }],
      "/fixture/external",
    ),
    false,
  );
});

test("later repair does not erase an earlier failed verification attempt", () => {
  assert.equal(
    failedChecksAfterMutation([
      end("before", "bash", { isError: true }),
      end("first", "edit"),
      end("failed", "bash", { isError: true }),
      end("second", "edit"),
      end("pass", "bash"),
    ]),
    1,
  );
  assert.equal(
    failedChecksAfterMutation([
      end("before", "bash", { isError: true }),
      end("first", "edit"),
      end("pass", "bash"),
    ]),
    0,
  );
});

test("failed verification also follows a source change made via bash", () => {
  assert.equal(
    failedChecksAfterMutation(
      [
        end("bash-edit", "bash", { sourceHash: "new" }),
        end("test-failed", "bash", { sourceHash: "new", isError: true }),
      ],
      "old",
    ),
    1,
  );
});
