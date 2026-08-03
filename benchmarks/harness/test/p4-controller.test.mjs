import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadP4Manifest } from "../p4-manifest.mjs";
import {
  assertPinnedModelsAvailable,
  createP4Result,
  disposeP4Worktree,
  inspectAgentChanges,
  pinRuntimeRoles,
  prepareP4Worktree,
  runP4Task,
  validatePrivateP4Task,
} from "../p4-controller.mjs";

const root = new URL("../../..", import.meta.url).pathname;
const manifest = loadP4Manifest();
const prepared = prepareP4Worktree({
  root,
  reference: manifest.reference,
  taskId: "01-single-file-change",
});
try {
  assert.equal(prepared.worktree.includes("pi-p4-worktree-"), true);
  assert.equal(prepared.promptFingerprint.length, 64);
  // Historic task files are intentionally absent from the agent worktree.
  assert.throws(() =>
    readFileSync(
      `${prepared.worktree}/benchmarks/tasks/01-single-file-change/TASK.md`,
    ),
  );
  // P0-05: the worktree's own object database must not reach commits before
  // the reference, not merely hide them from a default `git log`. There are
  // two commits, not one: the fetched reference plus P4's own local setup
  // commit for the historic-tasks removal (P0-07) — both descend from and
  // are only reachable through the reference itself.
  assert.equal(
    execFileSync("git", ["log", "--oneline"], {
      cwd: prepared.worktree,
      encoding: "utf8",
    })
      .trim()
      .split("\n").length,
    2,
    "the worktree's history is the reference commit plus P4's own local setup commit",
  );
  const parentReference = execFileSync(
    "git",
    ["rev-parse", `${manifest.reference}~1`],
    { cwd: root, encoding: "utf8" },
  ).trim();
  const parentLookup = spawnSync(
    "git",
    ["cat-file", "-e", `${parentReference}^{commit}`],
    { cwd: prepared.worktree },
  );
  assert.notEqual(
    parentLookup.status,
    0,
    "the reference commit's own parent is not a reachable object in the worktree",
  );
} finally {
  disposeP4Worktree(prepared);
}

// P0-06: a task with a fixture overlay (files that did not exist yet at the
// reference commit) gets it restored and staged in the worktree.
const fixtureTaskPrepared = prepareP4Worktree({
  root,
  reference: manifest.reference,
  taskId: "02-local-bug",
});
try {
  const fixturePath = join(
    fixtureTaskPrepared.worktree,
    "benchmark-fixture",
    "run-fixture-test.mjs",
  );
  assert.equal(
    existsSync(fixturePath),
    true,
    "the fixture overlay is copied into the worktree",
  );
  const status = execFileSync(
    "git",
    ["status", "--porcelain", "benchmark-fixture"],
    {
      cwd: fixtureTaskPrepared.worktree,
      encoding: "utf8",
    },
  );
  assert.equal(
    status,
    "",
    "the fixture overlay is committed as part of the worktree's own baseline, not left staged (P0-07: a merely staged, uncommitted fixture would show up as an agent change in every run)",
  );
  const committedFiles = execFileSync(
    "git",
    ["show", "--name-only", "--format=", "HEAD"],
    { cwd: fixtureTaskPrepared.worktree, encoding: "utf8" },
  );
  assert.match(
    committedFiles,
    /^benchmark-fixture\/run-fixture-test\.mjs$/m,
    "the fixture overlay is part of the HEAD commit",
  );
} finally {
  disposeP4Worktree(fixtureTaskPrepared);
}

// P0-07: inspectAgentChanges must see staged and untracked changes, not
// only unstaged edits to already-tracked files.
const diffPrepared = prepareP4Worktree({
  root,
  reference: manifest.reference,
  taskId: "01-single-file-change",
});
try {
  const clean = inspectAgentChanges(diffPrepared.worktree);
  assert.deepEqual(clean.changedFiles, [], "a freshly prepared worktree has no changes yet");

  writeFileSync(join(diffPrepared.worktree, "untracked-agent-file.txt"), "new file\n");
  const withUntracked = inspectAgentChanges(diffPrepared.worktree);
  assert(
    withUntracked.changedFiles.includes("untracked-agent-file.txt"),
    "an untracked new file is reported",
  );
  assert.notEqual(
    withUntracked.diffFingerprint,
    clean.diffFingerprint,
    "an untracked new file changes the fingerprint",
  );

  execFileSync("git", ["add", "untracked-agent-file.txt"], {
    cwd: diffPrepared.worktree,
  });
  const withStaged = inspectAgentChanges(diffPrepared.worktree);
  assert(
    withStaged.changedFiles.includes("untracked-agent-file.txt"),
    "a staged new file is still reported once it is no longer untracked",
  );
  assert.notEqual(
    withStaged.diffFingerprint,
    withUntracked.diffFingerprint,
    "moving a change from untracked to staged changes the fingerprint",
  );
} finally {
  disposeP4Worktree(diffPrepared);
}

const pinned = pinRuntimeRoles(manifest.roles, {
  main: {
    model: manifest.roles.main.model,
    thinking: "high",
    provider: "test",
  },
  investigator: { model: manifest.roles.investigator.model, thinking: "high" },
  debugger: { model: manifest.roles.debugger.model, thinking: "high" },
});
assert.equal(pinned.verifier.enabled, false);
assert.throws(() =>
  pinRuntimeRoles(manifest.roles, {
    main: { model: "fallback", thinking: "high" },
  }),
);
assert.equal(
  assertPinnedModelsAvailable(manifest.roles, [manifest.roles.main.model]),
  true,
);
assert.throws(
  () => assertPinnedModelsAvailable(manifest.roles, []),
  /unavailable/,
);

const privateRoot = mkdtempSync(join(tmpdir(), "pi-p4-private-"));
try {
  const task = join(privateRoot, "tasks", "01-single-file-change");
  mkdirSync(task, { recursive: true });
  writeFileSync(
    join(task, "metadata.json"),
    JSON.stringify({
      taskId: "01-single-file-change",
      seriesId: "P4",
      inputFingerprint: "inputs-v1",
    }),
  );
  writeFileSync(
    join(task, "evaluator.mjs"),
    "process.stdout.write(JSON.stringify({status: 'valid', evaluatorFingerprint: 'private-v1'}))",
  );
  assert.equal(
    validatePrivateP4Task(privateRoot, "01-single-file-change")
      .inputFingerprint,
    "inputs-v1",
  );
  const originalPrivateRoot = process.env.PI_BENCHMARK_PRIVATE_ROOT;
  process.env.PI_BENCHMARK_PRIVATE_ROOT = privateRoot;
  try {
    const executed = await runP4Task({
      root,
      manifest,
      run: manifest.runs[0],
      privateRoot,
      availableModels: [manifest.roles.main.model],
      launchAgent: async ({ env, prompt }) => {
        assert.equal(env.PI_BENCHMARK_PRIVATE_ROOT, undefined);
        assert(prompt.length > 40, "agent receives the public prompt text");
        return {
          resolvedRoles: {
            main: { model: manifest.roles.main.model, thinking: "high" },
            investigator: {
              model: manifest.roles.investigator.model,
              thinking: "high",
            },
            debugger: {
              model: manifest.roles.debugger.model,
              thinking: "high",
            },
          },
          roleHistory: [],
          sessionMetrics: { durationMs: 1 },
        };
      },
    });
    assert.equal(executed.evaluator.status, "valid");
    assert.equal(executed.diff.visibleTestChanges.length, 0);
  } finally {
    if (originalPrivateRoot === undefined)
      delete process.env.PI_BENCHMARK_PRIVATE_ROOT;
    else process.env.PI_BENCHMARK_PRIVATE_ROOT = originalPrivateRoot;
  }
} finally {
  rmSync(privateRoot, { recursive: true, force: true });
}

// P0-04: the with/without-subagent A/B variant is enforced against a real
// session file, not asserted by the caller.
function sessionWithSubagentCalls(path, count) {
  mkdirSync(join(path, ".."), { recursive: true });
  const lines = [];
  for (let index = 0; index < count; index += 1) {
    lines.push(
      JSON.stringify({
        type: "message",
        message: {
          role: "assistant",
          content: [{ type: "toolCall", name: "subagent" }],
        },
      }),
    );
  }
  writeFileSync(path, `${lines.join("\n")}\n`);
}

const variantPrivateRoot = mkdtempSync(
  join(tmpdir(), "pi-p4-variant-private-"),
);
try {
  const task = join(variantPrivateRoot, "tasks", "10-with-without-subagent");
  mkdirSync(task, { recursive: true });
  writeFileSync(
    join(task, "metadata.json"),
    JSON.stringify({
      taskId: "10-with-without-subagent",
      seriesId: "P4",
      inputFingerprint: "inputs-variant",
    }),
  );
  writeFileSync(
    join(task, "evaluator.mjs"),
    "process.stdout.write(JSON.stringify({status: 'valid', evaluatorFingerprint: 'private-variant'}))",
  );
  const originalPrivateRoot = process.env.PI_BENCHMARK_PRIVATE_ROOT;
  process.env.PI_BENCHMARK_PRIVATE_ROOT = variantPrivateRoot;
  try {
    const withoutSubagentRun = manifest.runs.find(
      (candidate) => candidate.variant === "without-subagent",
    );
    const withSubagentRun = manifest.runs.find(
      (candidate) => candidate.variant === "with-subagent",
    );
    const resolvedRolesFor = () => ({
      main: { model: manifest.roles.main.model, thinking: "high" },
      investigator: {
        model: manifest.roles.investigator.model,
        thinking: "high",
      },
      debugger: { model: manifest.roles.debugger.model, thinking: "high" },
    });
    const sessionCounter = { value: 0 };
    async function runWithSubagentCalls(run, count) {
      sessionCounter.value += 1;
      const sessionPath = join(
        variantPrivateRoot,
        "sessions",
        `session-${sessionCounter.value}.jsonl`,
      );
      return runP4Task({
        root,
        manifest,
        run,
        privateRoot: variantPrivateRoot,
        availableModels: [manifest.roles.main.model],
        launchAgent: async () => {
          sessionWithSubagentCalls(sessionPath, count);
          return {
            resolvedRoles: resolvedRolesFor(),
            roleHistory: [],
            sessionMetrics: { durationMs: 1 },
            sessionPath,
          };
        },
      });
    }

    const cleanWithoutSubagent = await runWithSubagentCalls(
      withoutSubagentRun,
      0,
    );
    assert.equal(
      cleanWithoutSubagent.variantViolation,
      false,
      "zero subagent calls satisfies without-subagent",
    );
    const violatingWithoutSubagent = await runWithSubagentCalls(
      withoutSubagentRun,
      1,
    );
    assert.equal(
      violatingWithoutSubagent.variantViolation,
      true,
      "any subagent call violates without-subagent",
    );
    const cleanWithSubagent = await runWithSubagentCalls(withSubagentRun, 1);
    assert.equal(
      cleanWithSubagent.variantViolation,
      false,
      "a call count within the configured cap satisfies with-subagent",
    );
    const violatingWithSubagent = await runWithSubagentCalls(
      withSubagentRun,
      999,
    );
    assert.equal(
      violatingWithSubagent.variantViolation,
      true,
      "exceeding the configured spawn cap violates with-subagent",
    );
  } finally {
    if (originalPrivateRoot === undefined)
      delete process.env.PI_BENCHMARK_PRIVATE_ROOT;
    else process.env.PI_BENCHMARK_PRIVATE_ROOT = originalPrivateRoot;
  }
} finally {
  rmSync(variantPrivateRoot, { recursive: true, force: true });
}

const result = createP4Result({
  manifest,
  run: manifest.runs[0],
  promptFingerprint: "a".repeat(64),
  resolvedRoles: {
    main: { model: manifest.roles.main.model, thinking: "high" },
    investigator: {
      model: manifest.roles.investigator.model,
      thinking: "high",
    },
    debugger: { model: manifest.roles.debugger.model, thinking: "high" },
  },
  evaluator: { status: "valid", evaluatorFingerprint: "private-v1" },
  inputFingerprint: "input-v1",
  sessionMetrics: { durationMs: 1 },
  diff: { files: [] },
});
assert.equal(result.seriesId, "P4");
assert.equal(result.configFingerprint.length, 64);
console.log("p4 controller test passed");
