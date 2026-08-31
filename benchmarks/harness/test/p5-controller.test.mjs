import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadP5Manifest } from "../p5-manifest.mjs";
import {
  createP5Result,
  expectedRolesFor,
  pinRuntimeRoles,
  runP5Task,
  scanForNetworkToolCalls,
  validatePrivateP5Task,
} from "../p5-controller.mjs";

const root = new URL("../../..", import.meta.url).pathname;
const manifest = loadP5Manifest();

// --- pinRuntimeRoles: the exact bug found by the first real P5 run ---
// A role never invoked (no subagent-artifacts entry) must NOT be treated as
// a pin violation — Pi's delegation is conditional (AGENTS.md), so 0
// subagent calls is a legitimate outcome, not a fairness failure.
{
  const piRoles = manifest.harnesses.pi.roles;
  const onlyMainInvoked = pinRuntimeRoles(piRoles, {
    main: {
      model: piRoles.main.model,
      thinking: piRoles.main.thinking,
      provider: "test",
    },
  });
  assert.equal(onlyMainInvoked.main.invoked, true);
  assert.equal(onlyMainInvoked.investigator.invoked, false);
  assert.equal(onlyMainInvoked.debugger.invoked, false);
  assert.equal(onlyMainInvoked.verifier.enabled, false);

  // Idempotent on its own sanitized output (createP5Result re-validates it).
  const reValidated = pinRuntimeRoles(piRoles, onlyMainInvoked);
  assert.deepEqual(reValidated, onlyMainInvoked);

  // main missing entirely is still a hard failure.
  assert.throws(
    () => pinRuntimeRoles(piRoles, {}),
    /main must always be invoked/,
  );

  // An invoked-but-wrong-model subagent is still a hard failure.
  assert.throws(
    () =>
      pinRuntimeRoles(piRoles, {
        main: { model: piRoles.main.model, thinking: piRoles.main.thinking },
        investigator: { model: "wrong/model", thinking: piRoles.main.thinking },
      }),
    /differs from the manifest pin/,
  );
}

// --- expectedRolesFor / createP5Result / scanForNetworkToolCalls ---
{
  assert.deepEqual(expectedRolesFor(manifest, "codex"), {
    main: {
      model: manifest.harnesses.codex.model,
      thinking: manifest.harnesses.codex.reasoningEffort,
    },
  });

  const result = createP5Result({
    manifest,
    run: { id: "p5-smoke-05-pi", harness: "pi", stackMode: "core-parity" },
    promptFingerprint: "a".repeat(64),
    resolvedRoles: pinRuntimeRoles(manifest.harnesses.pi.roles, {
      main: {
        model: manifest.harnesses.pi.roles.main.model,
        thinking: manifest.harnesses.pi.roles.main.thinking,
      },
    }),
    evaluator: { status: "pass" },
    inputFingerprint: "input-v1",
    automaticMetrics: { modelCalls: 1 },
    diff: { changedFiles: [] },
  });
  assert.equal(result.seriesId, "P5-LUNA-HARNESS");
  assert.equal(result.configFingerprint.length, 64);

  const tracePath = join(
    mkdtempSync(join(tmpdir(), "p5-net-test-")),
    "trace.jsonl",
  );
  writeFileSync(
    tracePath,
    'no network here\nran "curl -sS https://example.com"\n',
  );
  assert.equal(scanForNetworkToolCalls(tracePath), 1);
  assert.equal(scanForNetworkToolCalls(undefined), null);
}

// --- runP5Task end-to-end with stub launchers (no real Pi/Codex process) ---
{
  const privateRoot = mkdtempSync(join(tmpdir(), "pi-p5-private-"));
  try {
    const task = join(privateRoot, "tasks", "05-refactor-no-behavior-change");
    mkdirSync(task, { recursive: true });
    writeFileSync(
      join(task, "metadata.json"),
      JSON.stringify({
        taskId: "05-refactor-no-behavior-change",
        seriesId: "P5-LUNA-HARNESS",
        inputFingerprint: "inputs-v1",
      }),
    );
    writeFileSync(
      join(task, "evaluator.mjs"),
      "process.stdout.write(JSON.stringify({status: 'pass', evaluatorFingerprint: 'private-v1'}))",
    );
    assert.equal(
      validatePrivateP5Task(privateRoot, "05-refactor-no-behavior-change")
        .inputFingerprint,
      "inputs-v1",
    );

    const originalPrivateRoot = process.env.PI_BENCHMARK_PRIVATE_ROOT;
    process.env.PI_BENCHMARK_PRIVATE_ROOT = privateRoot;
    try {
      const executed = await runP5Task({
        root,
        manifest,
        run: {
          id: "p5-smoke-05-pi",
          task: "05-refactor-no-behavior-change",
          harness: "pi",
          stackMode: "core-parity",
        },
        privateRoot,
        availableModels: [manifest.harnesses.pi.roles.main.model],
        launchAgentByHarness: {
          pi: async ({ env, prompt }) => {
            assert.equal(env.PI_BENCHMARK_PRIVATE_ROOT, undefined);
            assert(prompt.length > 20, "agent receives the public prompt text");
            return {
              resolvedRoles: {
                main: {
                  model: manifest.harnesses.pi.roles.main.model,
                  thinking: manifest.harnesses.pi.roles.main.thinking,
                },
              },
              roleHistory: [],
              sessionMetrics: { durationMs: 1 },
            };
          },
        },
        collectPiMetrics: async () => ({ automatic: { modelCalls: 3 } }),
        collectCodexMetrics: async () => ({ automatic: { modelCalls: 0 } }),
      });
      assert.equal(executed.evaluator.status, "pass");
      assert.equal(executed.resolvedRoles.investigator.invoked, false);
      assert.equal(executed.harness, "pi");
    } finally {
      if (originalPrivateRoot === undefined)
        delete process.env.PI_BENCHMARK_PRIVATE_ROOT;
      else process.env.PI_BENCHMARK_PRIVATE_ROOT = originalPrivateRoot;
    }
  } finally {
    rmSync(privateRoot, { recursive: true, force: true });
  }
}

console.log("p5 controller test passed");
