import { counters as summary } from "./shared/assertions.mjs";

await import("./workflow-mode/mode.test.mjs");
await import("./workflow-mode/permissions.test.mjs");
await import("./workflow-mode/e2e.test.mjs");

const { passed, failed } = summary();
if (failed > 0) {
  console.error(`\nFAIL: ${passed} passed, ${failed} failed`);
  process.exit(1);
}
console.log(`\nPASS: ${passed} passed, 0 failed`);
