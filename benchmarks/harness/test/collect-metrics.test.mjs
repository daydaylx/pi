import assert from "node:assert/strict";
import { collectSessionMetrics } from "../collect-metrics.mjs";

const metrics = collectSessionMetrics([
  {
    type: "message",
    timestamp: "2026-01-01T00:00:00.000Z",
    message: {
      role: "assistant",
      usage: {
        input: 10,
        output: 4,
        reasoning: 2,
        cacheRead: 80,
        cacheWrite: 3,
        totalTokens: 99,
      },
    },
  },
  {
    type: "message",
    timestamp: "2026-01-01T00:00:01.000Z",
    message: {
      role: "assistant",
      usage: {
        input: 5,
        output: 6,
        cacheRead: 20,
        totalTokens: 31,
      },
    },
  },
]);

assert.deepEqual(metrics.tokens, {
  input: 15,
  output: 10,
  reasoning: 2,
  cacheRead: 100,
  cacheWrite: 3,
  providerReportedTotal: 130,
});
assert.equal(metrics.durationMs, 1000);
console.log("collect metrics token aggregation test passed.");
