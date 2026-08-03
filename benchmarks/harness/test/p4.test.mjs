// Real end-to-end CLI test: runs benchmarks/harness/p4.mjs as an actual
// subprocess (not just calling its functions in-process), the same way
// p3.test.mjs proves the P3 CLI. This is the P0-03 regression test: before
// this file, p4-controller.mjs only had mock-driven unit tests and no
// runnable CLI existed at all.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadP4Manifest } from "../p4-manifest.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const harness = join(here, "..");
const controller = join(harness, "p4.mjs");
const stub = join(here, "p4-agent-stub.mjs");
const sourceRoot = join(harness, "..", "..");
const manifest = loadP4Manifest();
const run = manifest.runs.find(
  (candidate) => candidate.task === "01-single-file-change",
);
assert(run, "manifest still has the 01-single-file-change pilot run");

const stateBase = mkdtempSync(join(tmpdir(), "pi-p4-test-"));
const privateRoot = mkdtempSync(join(tmpdir(), "pi-p4-private-test-"));

function setUpPrivateTask() {
  const task = join(privateRoot, "tasks", run.task);
  mkdirSync(task, { recursive: true });
  writeFileSync(
    join(task, "metadata.json"),
    JSON.stringify({
      taskId: run.task,
      seriesId: "P4",
      inputFingerprint: "p4-cli-test-input",
    }),
  );
  writeFileSync(
    join(task, "evaluator.mjs"),
    "process.stdout.write(JSON.stringify({status: 'valid', evaluatorFingerprint: 'p4-cli-test-evaluator'}))",
  );
}

const environment = {
  ...process.env,
  XDG_STATE_HOME: stateBase,
  P4_AGENT_MODULE: stub,
  P4_OFFLINE_TEST: "1",
  P4_AVAILABLE_MODELS: JSON.stringify([manifest.roles.main.model]),
  PI_BENCHMARK_PRIVATE_ROOT: privateRoot,
};

function p4(...args) {
  return execFileSync(process.execPath, [controller, ...args], {
    cwd: sourceRoot,
    env: environment,
    encoding: "utf8",
  });
}

try {
  setUpPrivateTask();
  assert.match(p4("validate"), /valid/);

  const stateRoot = join(stateBase, "pi-p4");
  assert.match(p4("run", run.id), /Finished/);
  assert.equal(
    statSync(stateRoot).mode & 0o777,
    0o700,
    "P4 state root is private",
  );

  const resultPath = join(stateRoot, "runs", run.id, "run-result.json");
  const result = JSON.parse(readFileSync(resultPath, "utf8"));
  assert.equal(result.schemaVersion, "2.0.0");
  assert.equal(result.seriesId, "P4");
  assert.equal(result.runId, run.id);
  assert.equal(result.resolvedRoles.main.model, manifest.roles.main.model);
  assert.equal(
    result.resolvedRoles.main.thinking,
    manifest.roles.main.thinking,
  );
  // The stub wrote real subagent-artifacts meta.json files for both active
  // non-main roles; the real reader (not a mock) must have picked them up.
  assert.equal(
    result.resolvedRoles.investigator.model,
    manifest.roles.investigator.model,
  );
  assert.equal(
    result.resolvedRoles.debugger.model,
    manifest.roles.debugger.model,
  );
  assert.equal(result.resolvedRoles.verifier.enabled, false);
  assert.equal(
    result.sessionMetrics.roleHistory.length,
    2,
    "one history entry per real subagent artifact",
  );
  for (const entry of result.sessionMetrics.roleHistory) {
    assert.equal(entry.parentRunId, run.id);
    assert.equal(typeof entry.durationMs, "number");
    assert.equal(typeof entry.tokens, "number");
  }
  assert.equal(result.evaluator.status, "valid");
  assert(result.diff, "diff inspection ran against the real worktree");

  const rerun = spawnSync(process.execPath, [controller, "run", run.id], {
    cwd: sourceRoot,
    env: environment,
    encoding: "utf8",
  });
  assert.notEqual(rerun.status, 0, "a second run for the same id is refused");
  assert.match(rerun.stderr, /already has a stored result/);
} finally {
  rmSync(stateBase, { recursive: true, force: true });
  rmSync(privateRoot, { recursive: true, force: true });
}

console.log("P4 CLI offline test passed.");
