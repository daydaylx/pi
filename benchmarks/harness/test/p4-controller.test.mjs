import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadP4Manifest } from "../p4-manifest.mjs";
import { createP4Result, disposeP4Worktree, pinRuntimeRoles, prepareP4Worktree, validatePrivateP4Task } from "../p4-controller.mjs";

const root = new URL("../../..", import.meta.url).pathname;
const manifest = loadP4Manifest();
const prepared = prepareP4Worktree({ root, reference: manifest.reference, taskId: "01-single-file-change" });
try {
  assert.equal(prepared.worktree.includes("pi-p4-worktree-"), true);
  assert.equal(prepared.promptFingerprint.length, 64);
  // Historic task files are intentionally absent from the agent worktree.
  assert.throws(() => readFileSync(`${prepared.worktree}/benchmarks/tasks/01-single-file-change/TASK.md`));
} finally { disposeP4Worktree({ root, ...prepared }); }

const pinned = pinRuntimeRoles(manifest.roles, {
  main: { model: manifest.roles.main.model, thinking: "high", provider: "test" },
  planner: { model: manifest.roles.planner.model, thinking: "high" },
  worker: { model: manifest.roles.worker.model, thinking: "high" },
});
assert.equal(pinned.reviewer.enabled, false);
assert.throws(() => pinRuntimeRoles(manifest.roles, { main: { model: "fallback", thinking: "high" } }));

const privateRoot = mkdtempSync(join(tmpdir(), "pi-p4-private-"));
try {
  const task = join(privateRoot, "tasks", "01-single-file-change"); mkdirSync(task, { recursive: true });
  writeFileSync(join(task, "metadata.json"), JSON.stringify({ taskId: "01-single-file-change", seriesId: "P4", inputFingerprint: "inputs-v1" }));
  writeFileSync(join(task, "evaluator.mjs"), "process.stdout.write(JSON.stringify({status: 'valid'}))");
  assert.equal(validatePrivateP4Task(privateRoot, "01-single-file-change").inputFingerprint, "inputs-v1");
} finally { rmSync(privateRoot, { recursive: true, force: true }); }

const result = createP4Result({ manifest, run: manifest.runs[0], promptFingerprint: "a".repeat(64), resolvedRoles: {
  main: { model: manifest.roles.main.model, thinking: "high" }, planner: { model: manifest.roles.planner.model, thinking: "high" }, worker: { model: manifest.roles.worker.model, thinking: "high" },
}, evaluator: { status: "valid", evaluatorFingerprint: "private-v1" }, inputFingerprint: "input-v1", sessionMetrics: { durationMs: 1 }, diff: { files: [] } });
assert.equal(result.seriesId, "P4");
assert.equal(result.configFingerprint.length, 64);
console.log("p4 controller test passed");
