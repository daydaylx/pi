/**
 * Workflow-v3 regression runner.
 *
 * Imports the domain suites sequentially — order is deterministic and a
 * failure stays locatable to one area — then reports the single total the
 * counters in shared/assertions.mjs accumulated.
 */
import { summary } from "./workflow-v3/assertions.mjs";

await import("./workflow-v3/plan-snapshot.test.mjs");
await import("./workflow-v3/planning.test.mjs");
await import("./workflow-v3/execution.test.mjs");
await import("./workflow-v3/completion.test.mjs");
await import("./workflow-v3/verification-gate.test.mjs");
await import("./workflow-v3/direct-task.test.mjs");
await import("./workflow-v3/recovery.test.mjs");
await import("./workflow-v3/migration.test.mjs");
await import("./workflow-v3/concurrency.test.mjs");
await import("./workflow-v3/permission-policy.test.mjs");
await import("./workflow-v3/permission-state.test.mjs");
await import("./workflow-v3/permissions.test.mjs");
await import("./workflow-v3/presentation.test.mjs");
await import("./workflow-v3/p1-transitions.test.mjs");
await import("./workflow-v3/control-center-menu.test.mjs");
await import("./workflow-v3/integration.test.mjs");
await import("./workflow-v3/routing.test.mjs");
await import("./workflow-v3/agent-model-menu.test.mjs");
await import("./workflow-v3/plan-editor.test.mjs");

const { passed, failed } = summary();
if (failed > 0) {
  console.error(`\nFAIL: ${passed} passed, ${failed} failed`);
  process.exit(1);
}
console.log(`\nPASS: ${passed} passed, 0 failed`);
