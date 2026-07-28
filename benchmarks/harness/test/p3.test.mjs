import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const harness = join(here, "..");
const controller = join(harness, "p3.mjs");
const stub = join(here, "p3-agent-stub.mjs");
const sourceRoot = join(harness, "..", "..");
const stateBase = mkdtempSync(join(tmpdir(), "pi-p3-test-"));
const environment = {
  ...process.env,
  XDG_STATE_HOME: stateBase,
  P3_AGENT_MODULE: stub,
  P3_OFFLINE_TEST: "1",
};

function p3(...args) {
  return execFileSync(process.execPath, [controller, ...args], {
    cwd: sourceRoot,
    env: environment,
    encoding: "utf8",
  });
}

try {
  assert.match(p3("validate"), /valid/);

  const beforeResults = readdirSync(join(sourceRoot, "benchmarks", "results")).sort();
  assert.match(p3("prepare", "p3-01-1"), /Prepared/);
  const stateRoot = join(stateBase, "pi-p3");
  const worktree = join(stateRoot, "worktrees", "p3-01-1");
  assert.equal(statSync(stateRoot).mode & 0o777, 0o700, "P3 state root is private");
  assert.equal(lstatSync(join(worktree, "auth.json")).isSymbolicLink(), true);
  assert.equal(lstatSync(join(worktree, "models-store.json")).isSymbolicLink(), true);
  assert.match(p3("launch", "p3-01-1"), /GNU-time record/);
  assert.match(p3("finish", "p3-01-1"), /local P3 state/);

  const result = JSON.parse(
    await import("node:fs").then(({ readFileSync }) =>
      readFileSync(join(stateRoot, "runs", "p3-01-1", "run-result.json"), "utf8"),
    ),
  );
  assert.equal(result.automatic.environment.reference, "e46915680d859ac9d6cac615cc197d5a31d46461");
  assert.equal(result.automatic.environment.testOnly, true);
  assert.match(result.automatic.environment.configHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(result.automatic.environment.benchmarkEnvironmentOverrides, {
  });
  const effectiveSetup = JSON.parse(
    await import("node:fs").then(({ readFileSync }) => readFileSync(join(worktree, "setup.json"), "utf8")),
  );
  assert.deepEqual(effectiveSetup.permissions.workflowDefaults, {
    work: "full-access",
    simple_plan: "full-access",
    detailed_plan: "full-access",
  });
  assert.equal(result.automatic.resources.launches.length, 1, "one GNU-time record for the scored launch");
  const resources = result.automatic.resources.launches[0];
  assert.equal(typeof resources.cpuUserSeconds, "number");
  assert.equal(typeof resources.cpuSystemSeconds, "number");
  assert.equal(typeof resources.wallSeconds, "number");
  assert.equal(typeof resources.peakRssKiB, "number");
  assert.equal(readdirSync(join(sourceRoot, "benchmarks", "results")).sort().join("\n"), beforeResults.join("\n"));
  assert.match(p3("cleanup", "p3-01-1"), /Cleaned/);
  assert.equal(existsSync(worktree), false, "cleanup removes the worktree");
  assert.equal(statSync(join(stateRoot, "runs", "p3-01-1")).isDirectory(), true, "results survive cleanup");

  assert.match(p3("prepare", "p3-diag-02-v8-cpu"), /Prepared/);
  assert.match(p3("launch", "p3-diag-02-v8-cpu"), /Diagnostic launch/);
  const diagnosticFinish = spawnSync(process.execPath, [controller, "finish", "p3-diag-02-v8-cpu"], {
    cwd: sourceRoot,
    env: environment,
    encoding: "utf8",
  });
  assert.notEqual(diagnosticFinish.status, 0);
  assert.match(diagnosticFinish.stderr, /intentionally unscored/);
  assert.match(p3("cleanup", "p3-diag-02-v8-cpu", "--purge"), /purged/);

  const summary = JSON.parse(p3("summarize"));
  assert.equal(summary.scoredRunCount, 33);
  assert.equal(summary.counts.invalid, 1, "an ungelöster Stub-Lauf bleibt ungültig");
  assert.equal(summary.counts.missing, 32);
  console.log("P3 harness offline test passed.");
} finally {
  for (const id of ["p3-01-1", "p3-diag-02-v8-cpu"]) {
    spawnSync(process.execPath, [controller, "cleanup", id, "--purge"], {
      cwd: sourceRoot,
      env: environment,
      stdio: "ignore",
    });
  }
  rmSync(stateBase, { recursive: true, force: true });
}
