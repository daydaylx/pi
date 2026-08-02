import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentEnvironment, loadPrivateTask, privateRoot, publicEvaluatorResult } from "../v2-private.mjs";

const root = mkdtempSync(join(tmpdir(), "pi-private-evaluator-"));
const task = join(root, "tasks", "01-single-file-change");
mkdirSync(task, { recursive: true });
writeFileSync(join(task, "metadata.json"), JSON.stringify({ taskId: "01-single-file-change" }));
writeFileSync(join(task, "evaluator.mjs"), "process.stdout.write('{}')\n");

assert.equal(privateRoot({ PI_BENCHMARK_PRIVATE_ROOT: root }), root);
assert.equal(loadPrivateTask(root, "01-single-file-change").metadata.taskId, "01-single-file-change");
assert.throws(() => privateRoot({}), /PI_BENCHMARK_PRIVATE_ROOT/);
assert.throws(() => loadPrivateTask(root, "../outside"), /invalid/);
assert.deepEqual(agentEnvironment({ PATH: "/bin", PI_BENCHMARK_PRIVATE_ROOT: root, P3_AGENT_MODULE: "x" }), { PATH: "/bin" });
const result = publicEvaluatorResult({
  status: "incorrect",
  summary: `reference solution is at ${root}/tasks/01-single-file-change`,
  privatePath: root,
}, root);
assert.equal(result.status, "incorrect");
assert.match(result.summary, /redacted/);
assert.doesNotMatch(JSON.stringify(result), new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
console.log("V2 private evaluator boundary test passed.");
