// Unit-Tests der GUI-Bridge-Kernlogik (kein Electron, kein echtes Pi).
import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { PassThrough } from "node:stream";
import {
  attachJsonlReader,
  buildPiArgs,
  summarizeToolCall,
  PiRpcManager,
} from "../main/pi-rpc-manager.js";

test("buildPiArgs: RPC-Modus immer, Optionen korrekt", () => {
  assert.deepEqual(buildPiArgs(), ["--mode", "rpc"]);
  assert.deepEqual(buildPiArgs({ noSession: true }), [
    "--mode",
    "rpc",
    "--no-session",
  ]);
  assert.deepEqual(buildPiArgs({ model: "gpt-x" }), [
    "--mode",
    "rpc",
    "--model",
    "gpt-x",
  ]);
});

test("summarizeToolCall: kompakte Cards je Werkzeug", () => {
  assert.equal(
    summarizeToolCall("read", { path: "/tmp/a.ts" }),
    "READ /tmp/a.ts",
  );
  assert.equal(
    summarizeToolCall("bash", { command: "npm test" }),
    "BASH npm test",
  );
  assert.equal(summarizeToolCall("edit", { path: "x/y.js" }), "EDIT x/y.js");
  const unknown = summarizeToolCall("my_tool", { query: "abc", limit: 5 });
  assert.match(unknown, /^MY_TOOL/);
});

function managerWithPending() {
  // Manager ohne echten Kindprozess; nur handleLine wird geprüft.
  const mgr = new PiRpcManager();
  return mgr;
}

test("handleLine: agent_start wird als Event gemeldet", () => {
  const mgr = managerWithPending();
  const seen = [];
  mgr.on("event", (m) => seen.push(m));
  mgr.handleLine('{"type":"agent_start"}');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].type, "agent_start");
});

test("handleLine: extension_ui_request löst ui-request aus", () => {
  const mgr = managerWithPending();
  let uiRequest = null;
  mgr.on("ui-request", (m) => {
    uiRequest = m;
  });
  mgr.handleLine(
    '{"type":"extension_ui_request","id":"u1","method":"select","options":["a"]}',
  );
  assert.equal(uiRequest.id, "u1");
});

test("handleLine: unparsebare Zeile erzeugt parse-error statt Crash", () => {
  const mgr = managerWithPending();
  let failed = null;
  mgr.on("parse-error", (line) => {
    failed = line;
  });
  mgr.handleLine("kein json {");
  assert.equal(failed, "kein json {");
});

test("JSONL-Reader trennt nur LF und erhält Unicode-Zeilentrenner", async () => {
  const stream = new PassThrough();
  const seen = [];
  attachJsonlReader(stream, (line) => seen.push(line));
  const ended = once(stream, "end");
  const first = '{"type":"event","text":"eins\u2028zwei\u2029drei"}';
  stream.write(`${first}\r\n`);
  stream.end('{"type":"last"}');
  await ended;
  assert.deepEqual(seen, [first, '{"type":"last"}']);
});

test("respondToUiRequest: erlaubt nur dokumentierte Antwortformen", () => {
  const mgr = managerWithPending();
  let written = [];
  mgr.child = { stdin: { write: (s) => written.push(JSON.parse(s)) } };
  mgr.respondToUiRequest({
    id: "r1",
    method: "select",
    value: "Allow",
  });
  assert.deepEqual(written[0], {
    type: "extension_ui_response",
    id: "r1",
    value: "Allow",
  });
  mgr.respondToUiRequest({
    id: "r2",
    method: "confirm",
    confirmed: true,
  });
  assert.equal(written[1].confirmed, true);
  mgr.respondToUiRequest({ id: "r3", method: "input", cancelled: true });
  assert.equal(written[2].cancelled, true);
  mgr.respondToUiRequest({ id: "r4", method: "editor", cancelled: true });
  assert.equal(written[3].cancelled, true);
  assert.throws(() =>
    mgr.respondToUiRequest({ id: "r5", method: "select", value: 42 }),
  );
});
