import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assert, eq, test, counters as summary } from "./shared/assertions.mjs";
import { importModule as load } from "./shared/jiti-loader.mjs";

const history = await load("extensions/second-opinion/run-history.ts");

const telemetry = (overrides = {}) => ({
  eventName: "second_opinion",
  requestId: "r1",
  decisionId: "d1",
  triggerSource: "main_agent",
  reasonCategory: "ARCHITECTURE_FORK",
  mainModelFamily: "x",
  opinionModelId: "y",
  gatewayId: "g",
  status: "completed",
  approved: "yes",
  inputTokens: 1200,
  outputTokens: 300,
  latencyMs: 4200,
  contextRefCount: 2,
  ...overrides,
});

await test("a completed opinion becomes an ok run-history entry with tokens and latency", () => {
  const entry = history.secondOpinionRunEntry(telemetry(), "/work", 1_700_000_000_000);
  eq(entry.agent, "second_opinion", "agent");
  eq(entry.status, "ok", "status");
  eq(entry.duration, 4200, "duration");
  eq(entry.ts, 1_700_000_000, "seconds timestamp");
  eq(entry.cwd, "/work", "cwd");
  eq(JSON.stringify(entry.tokens), JSON.stringify({ input: 1200, output: 300 }), "tokens");
  assert(!("exit" in entry), "no exit code on success");
  eq(entry.task, "ARCHITECTURE_FORK d1", "task carries only category and decision id");
});

await test("non-completed outcomes are recorded as errors, never as success", () => {
  for (const status of ["denied", "cancelled", "timeout", "provider_error", "blocked_sensitive_content", "stale_context"]) {
    const entry = history.secondOpinionRunEntry(telemetry({ status, inputTokens: undefined, outputTokens: undefined }));
    eq(entry.status, "error", status);
    eq(entry.exit, 1, `${status} exit`);
    assert(!("tokens" in entry), `${status} without tokens has no tokens`);
  }
});

await test("the entry never carries question, context or answer", () => {
  const entry = history.secondOpinionRunEntry(
    telemetry({ question: "secret question", answer: "secret" }),
  );
  assert(!/secret/.test(JSON.stringify(entry)), "no content leaks");
});

await test("recording appends one JSON line and never throws", () => {
  const dir = mkdtempSync(join(tmpdir(), "so-history-"));
  try {
    const file = join(dir, "nested", "run-history.jsonl");
    history.recordSecondOpinionRun(telemetry(), "/w", file);
    history.recordSecondOpinionRun(telemetry({ status: "timeout" }), "/w", file);
    const lines = readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    eq(lines.length, 2, "two lines");
    eq(lines[1].status, "error", "second status");
    // An unwritable target (a file used as a directory) must not throw.
    history.recordSecondOpinionRun(telemetry(), "/w", join(file, "impossible", "x.jsonl"));
    assert(existsSync(file), "history intact");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await test("the history path follows PI_CODING_AGENT_DIR", () => {
  eq(history.runHistoryPath({ PI_CODING_AGENT_DIR: "/a/b" }), "/a/b/run-history.jsonl", "override");
  assert(history.runHistoryPath({}).endsWith(".pi/agent/run-history.jsonl"), "default");
});

const { passed, failed } = summary();
if (failed > 0) {
  console.error(`\nFAIL: ${passed} passed, ${failed} failed`);
  process.exit(1);
}
console.log(`\nPASS: ${passed} passed, 0 failed`);
